-- Phase C.1 Route settings: order template contract.
-- One active order template per route, with reusable template items.
-- Used by /mcp/settings before wiring templates into order creation.

create table if not exists public.mcp_route_order_templates (
  id text primary key,
  route_id text not null references public.mcp_routes(id) on delete cascade,
  title text not null default 'Mau don hang',
  status text not null default 'active',
  note text,
  raw_payload jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (route_id)
);

create table if not exists public.mcp_route_order_template_items (
  id text primary key,
  template_id text not null references public.mcp_route_order_templates(id) on delete cascade,
  product_id text,
  product_name text not null,
  sku text,
  unit text,
  quantity numeric not null default 1,
  unit_price numeric not null default 0,
  discount numeric not null default 0,
  sort_order integer not null default 0,
  note text,
  raw_payload jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists mcp_route_order_template_items_template_idx
on public.mcp_route_order_template_items(template_id, sort_order);

create or replace function public.mcp_save_route_order_template(
  p_route_id text,
  p_title text default 'Mau don hang',
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
  v_quantity numeric;
  v_unit_price numeric;
  v_discount numeric;
  v_sort integer := 0;
  v_item_count integer := 0;
  now_ts timestamptz := now();
begin
  if p_route_id is null or length(trim(p_route_id)) = 0 then
    raise exception 'route_id_required' using errcode = '23514';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'template_items_required' using errcode = '23514';
  end if;

  select id, route_name into r
    from public.mcp_routes
   where id = p_route_id;

  if r.id is null then
    raise exception 'route_not_found' using errcode = '23503';
  end if;

  select id into v_template_id
    from public.mcp_route_order_templates
   where route_id = r.id;

  if v_template_id is null then
    v_template_id := 'mcp_order_template_' || replace(gen_random_uuid()::text, '-', '');
    insert into public.mcp_route_order_templates (
      id, route_id, title, status, note, raw_payload, created_at, updated_at
    ) values (
      v_template_id,
      r.id,
      coalesce(nullif(trim(coalesce(p_title, '')), ''), 'Mau don hang'),
      'active',
      nullif(trim(coalesce(p_note, '')), ''),
      jsonb_build_object('source', 'mcp_save_route_order_template'),
      now_ts,
      now_ts
    );
  else
    update public.mcp_route_order_templates
       set title = coalesce(nullif(trim(coalesce(p_title, '')), ''), title, 'Mau don hang'),
           status = 'active',
           note = nullif(trim(coalesce(p_note, '')), ''),
           updated_at = now_ts
     where id = v_template_id;

    delete from public.mcp_route_order_template_items
     where template_id = v_template_id;
  end if;

  for item in select value from jsonb_array_elements(p_items) loop
    v_product_name := nullif(trim(coalesce(item ->> 'productName', item ->> 'product_name', '')), '');
    if v_product_name is null then
      raise exception 'product_name_required' using errcode = '23514';
    end if;

    v_quantity := coalesce(nullif(item ->> 'quantity', '')::numeric, 1);
    v_unit_price := coalesce(nullif(coalesce(item ->> 'unitPrice', item ->> 'unit_price'), '')::numeric, 0);
    v_discount := coalesce(nullif(item ->> 'discount', '')::numeric, 0);

    if v_quantity <= 0 then
      raise exception 'quantity_required' using errcode = '23514';
    end if;
    if v_unit_price < 0 or v_discount < 0 then
      raise exception 'invalid_price_or_discount' using errcode = '23514';
    end if;

    v_sort := v_sort + 1;

    insert into public.mcp_route_order_template_items (
      id, template_id, product_id, product_name, sku, unit, quantity, unit_price,
      discount, sort_order, note, raw_payload, created_at, updated_at
    ) values (
      'mcp_order_template_item_' || replace(gen_random_uuid()::text, '-', ''),
      v_template_id,
      nullif(trim(coalesce(item ->> 'productId', item ->> 'product_id', '')), ''),
      v_product_name,
      nullif(trim(coalesce(item ->> 'sku', '')), ''),
      nullif(trim(coalesce(item ->> 'unit', '')), ''),
      v_quantity,
      v_unit_price,
      v_discount,
      v_sort,
      nullif(trim(coalesce(item ->> 'note', '')), ''),
      item || jsonb_build_object('source', 'mcp_save_route_order_template'),
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
