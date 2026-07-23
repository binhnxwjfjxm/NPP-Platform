alter table public.mcp_outlet_media
  add column if not exists delete_requested_at timestamptz,
  add column if not exists deleted_at timestamptz,
  add column if not exists delete_attempt_count integer not null default 0,
  add column if not exists last_delete_error text;

alter table public.mcp_outlet_media
  drop constraint if exists mcp_outlet_media_status_check;

alter table public.mcp_outlet_media
  add constraint mcp_outlet_media_status_check
  check (status in ('pending', 'ready', 'failed', 'deleting', 'delete_failed', 'deleted'));

create index if not exists mcp_outlet_media_delete_retry_idx
  on public.mcp_outlet_media(status, updated_at)
  where status in ('deleting', 'delete_failed');

create or replace function public.mcp_claim_outlet_media_delete(
  p_installation_id text,
  p_media_id text,
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
  if nullif(btrim(coalesce(p_installation_id, '')), '') is null then
    raise exception 'installation_id_required' using errcode = '23514';
  end if;
  if nullif(btrim(coalesce(p_media_id, '')), '') is null then
    raise exception 'media_id_required' using errcode = '23514';
  end if;

  select * into v_media
    from public.mcp_outlet_media
   where installation_id = p_installation_id
     and id = p_media_id
   for update;

  if not found then
    raise exception 'outlet_media_not_found' using errcode = '23503';
  end if;

  if v_media.status = 'deleted' then
    return to_jsonb(v_media);
  end if;

  update public.mcp_outlet_media
     set status = 'deleting',
         delete_requested_at = coalesce(delete_requested_at, now()),
         delete_attempt_count = delete_attempt_count + 1,
         last_delete_error = null,
         raw_payload = coalesce(raw_payload, '{}'::jsonb) || jsonb_build_object(
           'delete_claim_context', coalesce(p_context, '{}'::jsonb)
         ),
         updated_at = now()
   where id = v_media.id
   returning * into v_media;

  return to_jsonb(v_media);
end;
$function$;

create or replace function public.mcp_finish_outlet_media_delete(
  p_installation_id text,
  p_media_id text,
  p_succeeded boolean,
  p_error text default null,
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
   where installation_id = p_installation_id
     and id = p_media_id
   for update;

  if not found then
    raise exception 'outlet_media_not_found' using errcode = '23503';
  end if;

  if v_media.status = 'deleted' then
    return to_jsonb(v_media);
  end if;

  update public.mcp_outlet_media
     set status = case when coalesce(p_succeeded, false) then 'deleted' else 'delete_failed' end,
         deleted_at = case when coalesce(p_succeeded, false) then now() else deleted_at end,
         last_delete_error = case
           when coalesce(p_succeeded, false) then null
           else left(coalesce(nullif(btrim(p_error), ''), 'r2_delete_failed'), 500)
         end,
         raw_payload = coalesce(raw_payload, '{}'::jsonb) || jsonb_build_object(
           'delete_finish_context', coalesce(p_context, '{}'::jsonb)
         ),
         updated_at = now()
   where id = v_media.id
   returning * into v_media;

  return to_jsonb(v_media);
end;
$function$;

create or replace function public.mcp_claim_route_customer_media_delete(
  p_installation_id text,
  p_route_customer_id text,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_route_customer public.mcp_route_customers%rowtype;
  v_media jsonb := '[]'::jsonb;
begin
  if nullif(btrim(coalesce(p_route_customer_id, '')), '') is null then
    raise exception 'route_customer_id_required' using errcode = '23514';
  end if;

  select * into v_route_customer
    from public.mcp_route_customers
   where id = p_route_customer_id
   for update;

  if not found then
    raise exception 'route_customer_not_found' using errcode = '23503';
  end if;

  update public.mcp_route_customers
     set active = false,
         raw_payload = coalesce(raw_payload, '{}'::jsonb) || jsonb_build_object(
           'hard_delete_requested_context', coalesce(p_context, '{}'::jsonb)
         ),
         updated_at = now()
   where id = v_route_customer.id
   returning * into v_route_customer;

  update public.mcp_outlet_media
     set status = 'deleting',
         delete_requested_at = coalesce(delete_requested_at, now()),
         delete_attempt_count = delete_attempt_count + 1,
         last_delete_error = null,
         updated_at = now()
   where installation_id = p_installation_id
     and route_customer_id = v_route_customer.id
     and status <> 'deleted';

  select coalesce(jsonb_agg(to_jsonb(media) order by media.created_at), '[]'::jsonb)
    into v_media
    from public.mcp_outlet_media media
   where media.installation_id = p_installation_id
     and media.route_customer_id = v_route_customer.id
     and media.status <> 'deleted';

  return jsonb_build_object(
    'routeCustomer', to_jsonb(v_route_customer),
    'media', v_media
  );
end;
$function$;

create or replace function public.mcp_claim_route_media_delete(
  p_installation_id text,
  p_route_id text,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_route public.mcp_routes%rowtype;
  v_media jsonb := '[]'::jsonb;
begin
  if nullif(btrim(coalesce(p_route_id, '')), '') is null then
    raise exception 'route_id_required' using errcode = '23514';
  end if;

  select * into v_route
    from public.mcp_routes
   where id = p_route_id
   for update;

  if not found then
    raise exception 'route_not_found' using errcode = '23503';
  end if;

  update public.mcp_routes
     set active = false,
         raw_payload = coalesce(raw_payload, '{}'::jsonb) || jsonb_build_object(
           'hard_delete_requested_context', coalesce(p_context, '{}'::jsonb)
         ),
         updated_at = now()
   where id = v_route.id
   returning * into v_route;

  update public.mcp_route_customers
     set active = false,
         updated_at = now()
   where route_id = v_route.id;

  update public.mcp_outlet_media media
     set status = 'deleting',
         delete_requested_at = coalesce(media.delete_requested_at, now()),
         delete_attempt_count = media.delete_attempt_count + 1,
         last_delete_error = null,
         updated_at = now()
   where media.installation_id = p_installation_id
     and media.route_customer_id in (
       select route_customer.id
         from public.mcp_route_customers route_customer
        where route_customer.route_id = v_route.id
     )
     and media.status <> 'deleted';

  select coalesce(jsonb_agg(to_jsonb(media) order by media.created_at), '[]'::jsonb)
    into v_media
    from public.mcp_outlet_media media
    join public.mcp_route_customers route_customer
      on route_customer.id = media.route_customer_id
   where media.installation_id = p_installation_id
     and route_customer.route_id = v_route.id
     and media.status <> 'deleted';

  return jsonb_build_object(
    'route', to_jsonb(v_route),
    'media', v_media
  );
end;
$function$;

create or replace function public.mcp_claim_stale_outlet_media_delete(
  p_installation_id text,
  p_pending_before timestamptz,
  p_retry_before timestamptz,
  p_limit integer default 50,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_media jsonb := '[]'::jsonb;
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
begin
  with candidates as (
    select id
      from public.mcp_outlet_media
     where installation_id = p_installation_id
       and (
         (status in ('pending', 'failed') and created_at < p_pending_before)
         or
         (status in ('deleting', 'delete_failed') and updated_at < p_retry_before)
       )
     order by created_at
     for update skip locked
     limit v_limit
  ), claimed as (
    update public.mcp_outlet_media media
       set status = 'deleting',
           delete_requested_at = coalesce(media.delete_requested_at, now()),
           delete_attempt_count = media.delete_attempt_count + 1,
           last_delete_error = null,
           raw_payload = coalesce(media.raw_payload, '{}'::jsonb) || jsonb_build_object(
             'cleanup_claim_context', coalesce(p_context, '{}'::jsonb)
           ),
           updated_at = now()
      from candidates
     where media.id = candidates.id
     returning media.*
  )
  select coalesce(jsonb_agg(to_jsonb(claimed) order by claimed.created_at), '[]'::jsonb)
    into v_media
    from claimed;

  return v_media;
end;
$function$;

revoke all on function public.mcp_claim_outlet_media_delete(text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.mcp_claim_outlet_media_delete(text, text, jsonb)
  to service_role;

revoke all on function public.mcp_finish_outlet_media_delete(text, text, boolean, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.mcp_finish_outlet_media_delete(text, text, boolean, text, jsonb)
  to service_role;

revoke all on function public.mcp_claim_route_customer_media_delete(text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.mcp_claim_route_customer_media_delete(text, text, jsonb)
  to service_role;

revoke all on function public.mcp_claim_route_media_delete(text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.mcp_claim_route_media_delete(text, text, jsonb)
  to service_role;

revoke all on function public.mcp_claim_stale_outlet_media_delete(text, timestamptz, timestamptz, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.mcp_claim_stale_outlet_media_delete(text, timestamptz, timestamptz, integer, jsonb)
  to service_role;
