create table if not exists public.mcp_outlet_media (
  id text primary key,
  installation_id text not null,
  route_customer_id text not null references public.mcp_route_customers(id) on delete cascade,
  session_id text not null references public.mcp_route_sessions(id) on delete cascade,
  object_key text not null unique,
  media_type text not null default 'storefront' check (media_type in ('storefront')),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/webp', 'image/png')),
  expected_byte_size bigint not null check (expected_byte_size > 0 and expected_byte_size <= 5242880),
  actual_byte_size bigint,
  width integer,
  height integer,
  etag text,
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed', 'deleted')),
  client_upload_id text not null,
  captured_by text,
  captured_at timestamptz not null default now(),
  geo_lat double precision,
  geo_lng double precision,
  geo_accuracy double precision,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (installation_id, client_upload_id),
  check ((geo_lat is null and geo_lng is null) or (geo_lat between -90 and 90 and geo_lng between -180 and 180)),
  check (geo_accuracy is null or geo_accuracy >= 0)
);

create index if not exists mcp_outlet_media_route_customer_idx
  on public.mcp_outlet_media(route_customer_id, created_at desc);
create index if not exists mcp_outlet_media_session_idx
  on public.mcp_outlet_media(session_id, created_at desc);
create index if not exists mcp_outlet_media_pending_idx
  on public.mcp_outlet_media(status, created_at)
  where status = 'pending';

revoke all on table public.mcp_outlet_media from public, anon, authenticated;
grant select, insert, update on table public.mcp_outlet_media to service_role;

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
  if nullif(btrim(coalesce(p_session_id, '')), '') is null then
    raise exception 'session_id_required' using errcode = '23514';
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

  select * into v_session
    from public.mcp_route_sessions
   where id = p_session_id
   for update;
  if not found then raise exception 'session_not_found' using errcode = '23503'; end if;
  perform public.mcp_assert_session_mutable(v_session.id);

  select * into v_route_customer
    from public.mcp_route_customers
   where id = p_route_customer_id;
  if not found then raise exception 'route_customer_not_found' using errcode = '23503'; end if;
  if v_route_customer.route_id is distinct from v_session.route_id then
    raise exception 'route_customer_route_mismatch' using errcode = '23514';
  end if;

  select * into v_media
    from public.mcp_outlet_media
   where installation_id = p_installation_id
     and client_upload_id = p_client_upload_id
   for update;

  if found then
    if v_media.route_customer_id is distinct from p_route_customer_id
       or v_media.session_id is distinct from p_session_id
       or v_media.mime_type is distinct from p_mime_type
       or v_media.expected_byte_size is distinct from p_expected_byte_size then
      raise exception 'outlet_media_upload_conflict' using errcode = '23505';
    end if;
    return to_jsonb(v_media);
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
    v_media_id, p_installation_id, p_route_customer_id, p_session_id, v_object_key,
    p_mime_type, p_expected_byte_size, p_client_upload_id,
    nullif(btrim(coalesce(p_context ->> 'actorId', '')), ''),
    p_geo_lat, p_geo_lng, p_geo_accuracy,
    jsonb_build_object('foundation_context', coalesce(p_context, '{}'::jsonb))
  ) returning * into v_media;

  return to_jsonb(v_media);
end;
$function$;

create or replace function public.mcp_finalize_outlet_media_upload(
  p_media_id text,
  p_etag text,
  p_actual_byte_size bigint,
  p_content_type text,
  p_width integer default null,
  p_height integer default null,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_media public.mcp_outlet_media%rowtype;
begin
  select * into v_media
    from public.mcp_outlet_media
   where id = p_media_id
   for update;
  if not found then raise exception 'outlet_media_not_found' using errcode = '23503'; end if;

  if v_media.status = 'ready' then return to_jsonb(v_media); end if;
  if v_media.status <> 'pending' then
    raise exception 'outlet_media_not_pending' using errcode = '23514';
  end if;
  if p_content_type is distinct from v_media.mime_type then
    raise exception 'outlet_media_content_type_mismatch' using errcode = '23514';
  end if;
  if p_actual_byte_size is null or p_actual_byte_size < 1 or p_actual_byte_size > 5242880 then
    raise exception 'invalid_media_byte_size' using errcode = '23514';
  end if;

  update public.mcp_outlet_media
     set status = 'ready',
         etag = nullif(btrim(coalesce(p_etag, '')), ''),
         actual_byte_size = p_actual_byte_size,
         width = p_width,
         height = p_height,
         raw_payload = coalesce(raw_payload, '{}'::jsonb) || jsonb_build_object(
           'finalized_context', coalesce(p_context, '{}'::jsonb)
         ),
         updated_at = now()
   where id = p_media_id
   returning * into v_media;

  return to_jsonb(v_media);
end;
$function$;

revoke all on function public.mcp_prepare_outlet_media_upload(text, text, text, text, text, bigint, double precision, double precision, double precision, jsonb)
  from public, anon, authenticated;
grant execute on function public.mcp_prepare_outlet_media_upload(text, text, text, text, text, bigint, double precision, double precision, double precision, jsonb)
  to service_role;

revoke all on function public.mcp_finalize_outlet_media_upload(text, text, bigint, text, integer, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.mcp_finalize_outlet_media_upload(text, text, bigint, text, integer, integer, jsonb)
  to service_role;
