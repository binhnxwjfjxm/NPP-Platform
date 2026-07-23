-- Phase C.5 Route settings: skip / no-buy reason template.
-- Stores reusable reasons per route for skipped visits and no-buy outcomes.

create table if not exists public.mcp_route_skip_reason_templates (
  id text primary key,
  route_id text not null references public.mcp_routes(id) on delete cascade,
  title text not null default 'Mau ly do bo qua khong mua',
  status text not null default 'active',
  note text,
  raw_payload jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (route_id)
);

create table if not exists public.mcp_route_skip_reason_template_items (
  id text primary key,
  template_id text not null references public.mcp_route_skip_reason_templates(id) on delete cascade,
  reason_type text not null default 'skip',
  reason_text text not null,
  sort_order integer not null default 0,
  note text,
  raw_payload jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists mcp_route_skip_reason_template_items_template_idx
on public.mcp_route_skip_reason_template_items(template_id, sort_order);

create or replace function public.mcp_save_route_skip_reason_template(
  p_route_id text,
  p_title text default 'Mau ly do bo qua khong mua',
  p_note text default null,
  p_items jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  r record;
  v_template_id text;
  item jsonb;
  v_reason_type text;
  v_reason_text text;
  v_sort integer := 0;
  v_item_count integer := 0;
  now_ts timestamptz := now();
begin
  if p_route_id is null or length(trim(p_route_id)) = 0 then
    raise exception 'route_id_required' using errcode = '23514';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'skip_reason_items_required' using errcode = '23514';
  end if;

  select id, route_name into r from public.mcp_routes where id = p_route_id;
  if r.id is null then
    raise exception 'route_not_found' using errcode = '23503';
  end if;

  select id into v_template_id
    from public.mcp_route_skip_reason_templates
   where route_id = r.id;

  if v_template_id is null then
    v_template_id := 'mcp_skip_reason_template_' || replace(gen_random_uuid()::text, '-', '');
    insert into public.mcp_route_skip_reason_templates (
      id, route_id, title, status, note, raw_payload, created_at, updated_at
    ) values (
      v_template_id,
      r.id,
      coalesce(nullif(trim(coalesce(p_title, '')), ''), 'Mau ly do bo qua khong mua'),
      'active',
      nullif(trim(coalesce(p_note, '')), ''),
      jsonb_build_object('source','mcp_save_route_skip_reason_template'),
      now_ts,
      now_ts
    );
  else
    update public.mcp_route_skip_reason_templates
       set title = coalesce(nullif(trim(coalesce(p_title, '')), ''), title, 'Mau ly do bo qua khong mua'),
           status = 'active',
           note = nullif(trim(coalesce(p_note, '')), ''),
           updated_at = now_ts
     where id = v_template_id;

    delete from public.mcp_route_skip_reason_template_items
     where template_id = v_template_id;
  end if;

  for item in select value from jsonb_array_elements(p_items) loop
    v_reason_type := lower(coalesce(nullif(trim(coalesce(item ->> 'reasonType', item ->> 'reason_type', '')), ''), 'skip'));
    if v_reason_type not in ('skip','no_buy') then
      raise exception 'invalid_reason_type' using errcode = '23514';
    end if;

    v_reason_text := nullif(trim(coalesce(item ->> 'reasonText', item ->> 'reason_text', '')), '');
    if v_reason_text is null then
      raise exception 'reason_text_required' using errcode = '23514';
    end if;

    v_sort := v_sort + 1;

    insert into public.mcp_route_skip_reason_template_items (
      id, template_id, reason_type, reason_text, sort_order, note, raw_payload, created_at, updated_at
    ) values (
      'mcp_skip_reason_item_' || replace(gen_random_uuid()::text, '-', ''),
      v_template_id,
      v_reason_type,
      v_reason_text,
      v_sort,
      nullif(trim(coalesce(item ->> 'note','')), ''),
      item || jsonb_build_object('source','mcp_save_route_skip_reason_template'),
      now_ts,
      now_ts
    );

    v_item_count := v_item_count + 1;
  end loop;

  return jsonb_build_object(
    'templateId', v_template_id,
    'routeId', r.id,
    'routeName', r.route_name,
    'itemCount', v_item_count
  );
end;
$$;
