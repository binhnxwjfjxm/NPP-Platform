-- Phase C.2-C.4 Route settings templates.
-- Adds reusable templates per route for product tests, market reports, and follow-ups.

create table if not exists public.mcp_route_test_templates (
  id text primary key,
  route_id text not null references public.mcp_routes(id) on delete cascade,
  title text not null default 'Mau test san pham',
  status text not null default 'active',
  note text,
  raw_payload jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (route_id)
);

create table if not exists public.mcp_route_test_template_items (
  id text primary key,
  template_id text not null references public.mcp_route_test_templates(id) on delete cascade,
  product_id text,
  product_name text not null,
  default_status text not null default 'tested',
  sort_order integer not null default 0,
  note text,
  raw_payload jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists mcp_route_test_template_items_template_idx
on public.mcp_route_test_template_items(template_id, sort_order);

create table if not exists public.mcp_route_report_templates (
  id text primary key,
  route_id text not null references public.mcp_routes(id) on delete cascade,
  title text not null default 'Mau bao cao thi truong',
  report_type text not null default 'price',
  content text,
  price_summary text,
  competitor_summary text,
  display_summary text,
  stock_summary text,
  demand_summary text,
  opportunity_summary text,
  risk_summary text,
  next_action text,
  note text,
  status text not null default 'active',
  raw_payload jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (route_id)
);

create table if not exists public.mcp_route_followup_templates (
  id text primary key,
  route_id text not null references public.mcp_routes(id) on delete cascade,
  title text not null default 'Mau follow-up',
  due_days integer,
  priority text not null default 'medium',
  owner text,
  note text,
  followup_type text not null default 'general',
  status text not null default 'active',
  raw_payload jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (route_id)
);

create or replace function public.mcp_save_route_test_template(
  p_route_id text,
  p_title text default 'Mau test san pham',
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
  v_product_name text;
  v_status text;
  v_sort integer := 0;
  v_item_count integer := 0;
  now_ts timestamptz := now();
begin
  if p_route_id is null or length(trim(p_route_id)) = 0 then
    raise exception 'route_id_required' using errcode = '23514';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'test_template_items_required' using errcode = '23514';
  end if;

  select id, route_name into r from public.mcp_routes where id = p_route_id;
  if r.id is null then raise exception 'route_not_found' using errcode = '23503'; end if;

  select id into v_template_id from public.mcp_route_test_templates where route_id = r.id;
  if v_template_id is null then
    v_template_id := 'mcp_test_template_' || replace(gen_random_uuid()::text, '-', '');
    insert into public.mcp_route_test_templates (id, route_id, title, status, note, raw_payload, created_at, updated_at)
    values (v_template_id, r.id, coalesce(nullif(trim(coalesce(p_title, '')), ''), 'Mau test san pham'), 'active', nullif(trim(coalesce(p_note, '')), ''), jsonb_build_object('source','mcp_save_route_test_template'), now_ts, now_ts);
  else
    update public.mcp_route_test_templates
       set title = coalesce(nullif(trim(coalesce(p_title, '')), ''), title, 'Mau test san pham'),
           status = 'active', note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now_ts
     where id = v_template_id;
    delete from public.mcp_route_test_template_items where template_id = v_template_id;
  end if;

  for item in select value from jsonb_array_elements(p_items) loop
    v_product_name := nullif(trim(coalesce(item ->> 'productName', item ->> 'product_name', '')), '');
    if v_product_name is null then raise exception 'product_name_required' using errcode = '23514'; end if;
    v_status := lower(coalesce(nullif(trim(coalesce(item ->> 'defaultStatus', item ->> 'default_status', '')), ''), 'tested'));
    if v_status not in ('tested','ok','retry','not_suitable','follow_up') then
      raise exception 'invalid_test_status' using errcode = '23514';
    end if;
    v_sort := v_sort + 1;
    insert into public.mcp_route_test_template_items (id, template_id, product_id, product_name, default_status, sort_order, note, raw_payload, created_at, updated_at)
    values ('mcp_test_template_item_' || replace(gen_random_uuid()::text, '-', ''), v_template_id, nullif(trim(coalesce(item ->> 'productId', item ->> 'product_id', '')), ''), v_product_name, v_status, v_sort, nullif(trim(coalesce(item ->> 'note','')), ''), item || jsonb_build_object('source','mcp_save_route_test_template'), now_ts, now_ts);
    v_item_count := v_item_count + 1;
  end loop;

  return jsonb_build_object('templateId', v_template_id, 'routeId', r.id, 'routeName', r.route_name, 'itemCount', v_item_count);
end;
$$;

create or replace function public.mcp_save_route_report_template(
  p_route_id text,
  p_title text default 'Mau bao cao thi truong',
  p_report_type text default 'price',
  p_content text default null,
  p_price_summary text default null,
  p_competitor_summary text default null,
  p_display_summary text default null,
  p_stock_summary text default null,
  p_demand_summary text default null,
  p_opportunity_summary text default null,
  p_risk_summary text default null,
  p_next_action text default null,
  p_note text default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  r record;
  v_template_id text;
  v_report_type text;
  now_ts timestamptz := now();
begin
  if p_route_id is null or length(trim(p_route_id)) = 0 then
    raise exception 'route_id_required' using errcode = '23514';
  end if;
  select id, route_name into r from public.mcp_routes where id = p_route_id;
  if r.id is null then raise exception 'route_not_found' using errcode = '23503'; end if;

  v_report_type := lower(coalesce(nullif(trim(coalesce(p_report_type, '')), ''), 'price'));
  if v_report_type not in ('price','competitor','display','stock','demand','general') then
    raise exception 'invalid_report_type' using errcode = '23514';
  end if;

  select id into v_template_id from public.mcp_route_report_templates where route_id = r.id;
  if v_template_id is null then
    v_template_id := 'mcp_report_template_' || replace(gen_random_uuid()::text, '-', '');
    insert into public.mcp_route_report_templates (id, route_id, title, report_type, content, price_summary, competitor_summary, display_summary, stock_summary, demand_summary, opportunity_summary, risk_summary, next_action, note, status, raw_payload, created_at, updated_at)
    values (v_template_id, r.id, coalesce(nullif(trim(coalesce(p_title, '')), ''), 'Mau bao cao thi truong'), v_report_type, nullif(trim(coalesce(p_content,'')), ''), nullif(trim(coalesce(p_price_summary,'')), ''), nullif(trim(coalesce(p_competitor_summary,'')), ''), nullif(trim(coalesce(p_display_summary,'')), ''), nullif(trim(coalesce(p_stock_summary,'')), ''), nullif(trim(coalesce(p_demand_summary,'')), ''), nullif(trim(coalesce(p_opportunity_summary,'')), ''), nullif(trim(coalesce(p_risk_summary,'')), ''), nullif(trim(coalesce(p_next_action,'')), ''), nullif(trim(coalesce(p_note,'')), ''), 'active', jsonb_build_object('source','mcp_save_route_report_template'), now_ts, now_ts);
  else
    update public.mcp_route_report_templates
       set title = coalesce(nullif(trim(coalesce(p_title, '')), ''), title, 'Mau bao cao thi truong'), report_type = v_report_type,
           content = nullif(trim(coalesce(p_content,'')), ''), price_summary = nullif(trim(coalesce(p_price_summary,'')), ''), competitor_summary = nullif(trim(coalesce(p_competitor_summary,'')), ''), display_summary = nullif(trim(coalesce(p_display_summary,'')), ''), stock_summary = nullif(trim(coalesce(p_stock_summary,'')), ''), demand_summary = nullif(trim(coalesce(p_demand_summary,'')), ''), opportunity_summary = nullif(trim(coalesce(p_opportunity_summary,'')), ''), risk_summary = nullif(trim(coalesce(p_risk_summary,'')), ''), next_action = nullif(trim(coalesce(p_next_action,'')), ''), note = nullif(trim(coalesce(p_note,'')), ''), status = 'active', updated_at = now_ts
     where id = v_template_id;
  end if;

  return jsonb_build_object('templateId', v_template_id, 'routeId', r.id, 'routeName', r.route_name, 'reportType', v_report_type);
end;
$$;

create or replace function public.mcp_save_route_followup_template(
  p_route_id text,
  p_title text default 'Mau follow-up',
  p_due_days integer default null,
  p_priority text default 'medium',
  p_owner text default null,
  p_note text default null,
  p_followup_type text default 'general'
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  r record;
  v_template_id text;
  v_priority text;
  v_due_days integer;
  now_ts timestamptz := now();
begin
  if p_route_id is null or length(trim(p_route_id)) = 0 then
    raise exception 'route_id_required' using errcode = '23514';
  end if;
  select id, route_name into r from public.mcp_routes where id = p_route_id;
  if r.id is null then raise exception 'route_not_found' using errcode = '23503'; end if;

  v_priority := lower(coalesce(nullif(trim(coalesce(p_priority, '')), ''), 'medium'));
  if v_priority not in ('low','medium','high','urgent') then
    raise exception 'invalid_priority' using errcode = '23514';
  end if;
  v_due_days := p_due_days;
  if v_due_days is not null and v_due_days < 0 then
    raise exception 'invalid_due_days' using errcode = '23514';
  end if;

  select id into v_template_id from public.mcp_route_followup_templates where route_id = r.id;
  if v_template_id is null then
    v_template_id := 'mcp_followup_template_' || replace(gen_random_uuid()::text, '-', '');
    insert into public.mcp_route_followup_templates (id, route_id, title, due_days, priority, owner, note, followup_type, status, raw_payload, created_at, updated_at)
    values (v_template_id, r.id, coalesce(nullif(trim(coalesce(p_title, '')), ''), 'Mau follow-up'), v_due_days, v_priority, nullif(trim(coalesce(p_owner,'')), ''), nullif(trim(coalesce(p_note,'')), ''), lower(coalesce(nullif(trim(coalesce(p_followup_type,'')), ''), 'general')), 'active', jsonb_build_object('source','mcp_save_route_followup_template'), now_ts, now_ts);
  else
    update public.mcp_route_followup_templates
       set title = coalesce(nullif(trim(coalesce(p_title, '')), ''), title, 'Mau follow-up'), due_days = v_due_days, priority = v_priority, owner = nullif(trim(coalesce(p_owner,'')), ''), note = nullif(trim(coalesce(p_note,'')), ''), followup_type = lower(coalesce(nullif(trim(coalesce(p_followup_type,'')), ''), 'general')), status = 'active', updated_at = now_ts
     where id = v_template_id;
  end if;

  return jsonb_build_object('templateId', v_template_id, 'routeId', r.id, 'routeName', r.route_name, 'priority', v_priority, 'dueDays', v_due_days);
end;
$$;
