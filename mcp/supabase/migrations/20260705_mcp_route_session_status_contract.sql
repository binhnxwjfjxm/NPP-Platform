-- Phase C.7 Route session status contract.
-- Allowed session statuses: active, done, cancelled.
-- Updates an existing route session by selected route_id + session_date.

alter table public.mcp_route_sessions
  alter column status set default 'active';

alter table public.mcp_route_sessions
  alter column status set not null;

alter table public.mcp_route_sessions
  drop constraint if exists mcp_route_sessions_status_chk;

alter table public.mcp_route_sessions
  add constraint mcp_route_sessions_status_chk
  check (status in ('active','done','cancelled'));

create or replace function public.mcp_set_route_session_status(
  p_route_id text,
  p_session_date date,
  p_status text,
  p_note text default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  s record;
  v_status text;
  now_ts timestamptz := now();
begin
  if p_route_id is null or length(trim(p_route_id)) = 0 then
    raise exception 'route_id_required' using errcode = '23514';
  end if;
  if p_session_date is null then
    raise exception 'session_date_required' using errcode = '23514';
  end if;

  v_status := lower(coalesce(nullif(trim(coalesce(p_status, '')), ''), 'active'));
  if v_status not in ('active','done','cancelled') then
    raise exception 'invalid_session_status' using errcode = '23514';
  end if;

  select id, route_id, route_name, session_date, status
    into s
    from public.mcp_route_sessions
   where route_id = p_route_id
     and session_date = p_session_date;

  if s.id is null then
    raise exception 'route_session_not_found' using errcode = '23503';
  end if;

  update public.mcp_route_sessions
     set status = v_status,
         note = coalesce(nullif(trim(coalesce(p_note, '')), ''), note),
         raw_payload = coalesce(raw_payload, '{}'::jsonb) || jsonb_build_object('status_source', 'mcp_set_route_session_status'),
         updated_at = now_ts
   where id = s.id;

  return jsonb_build_object(
    'sessionId', s.id,
    'routeId', s.route_id,
    'routeName', s.route_name,
    'sessionDate', s.session_date,
    'status', v_status
  );
end;
$$;
