-- Phase C.6 Route settings: customer add rule.
-- Controls whether added customers are stored only in the active session,
-- only in the fixed route customer list, or in both places.

create table if not exists public.mcp_route_customer_add_rules (
  id text primary key,
  route_id text not null references public.mcp_routes(id) on delete cascade,
  add_mode text not null default 'session_only',
  title text not null default 'Luat them khach',
  note text,
  status text not null default 'active',
  raw_payload jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (route_id),
  constraint mcp_route_customer_add_rules_add_mode_chk check (add_mode in ('session_only','route_only','both'))
);

create or replace function public.mcp_save_route_customer_add_rule(
  p_route_id text,
  p_add_mode text default 'session_only',
  p_note text default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  r record;
  v_rule_id text;
  v_add_mode text;
  now_ts timestamptz := now();
begin
  if p_route_id is null or length(trim(p_route_id)) = 0 then
    raise exception 'route_id_required' using errcode = '23514';
  end if;

  v_add_mode := lower(coalesce(nullif(trim(coalesce(p_add_mode, '')), ''), 'session_only'));
  if v_add_mode not in ('session_only','route_only','both') then
    raise exception 'invalid_add_mode' using errcode = '23514';
  end if;

  select id, route_name into r from public.mcp_routes where id = p_route_id;
  if r.id is null then
    raise exception 'route_not_found' using errcode = '23503';
  end if;

  select id into v_rule_id
    from public.mcp_route_customer_add_rules
   where route_id = r.id;

  if v_rule_id is null then
    v_rule_id := 'mcp_customer_add_rule_' || replace(gen_random_uuid()::text, '-', '');
    insert into public.mcp_route_customer_add_rules (
      id, route_id, add_mode, title, note, status, raw_payload, created_at, updated_at
    ) values (
      v_rule_id,
      r.id,
      v_add_mode,
      'Luat them khach',
      nullif(trim(coalesce(p_note, '')), ''),
      'active',
      jsonb_build_object('source','mcp_save_route_customer_add_rule'),
      now_ts,
      now_ts
    );
  else
    update public.mcp_route_customer_add_rules
       set add_mode = v_add_mode,
           title = 'Luat them khach',
           note = nullif(trim(coalesce(p_note, '')), ''),
           status = 'active',
           updated_at = now_ts
     where id = v_rule_id;
  end if;

  return jsonb_build_object(
    'ruleId', v_rule_id,
    'routeId', r.id,
    'routeName', r.route_name,
    'addMode', v_add_mode
  );
end;
$$;
