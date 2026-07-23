-- Phase 6: contextual report templates.
-- Report templates are no longer hard-bound to one route.

create table if not exists public.mcp_competitors (
  id text primary key default ('mc_' || replace(gen_random_uuid()::text, '-', '')),
  competitor_name text not null,
  brand_name text,
  category text,
  area text,
  route_id text references public.mcp_routes(id) on delete set null,
  status text not null default 'active' check (status in ('active','hidden')),
  sort_order integer not null default 0,
  note text,
  raw_payload jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.mcp_customer_products (
  id text primary key default ('mcp_' || replace(gen_random_uuid()::text, '-', '')),
  route_id text references public.mcp_routes(id) on delete cascade,
  route_customer_id text references public.mcp_route_customers(id) on delete cascade,
  customer_id text,
  product_id text,
  product_name text not null,
  brand_name text,
  product_source text not null default 'used' check (product_source in ('used','bought','tested','competitor','manual')),
  status text not null default 'active' check (status in ('active','hidden')),
  last_seen_at timestamptz,
  sort_order integer not null default 0,
  note text,
  raw_payload jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.mcp_report_templates (
  id text primary key default ('mrt_' || replace(gen_random_uuid()::text, '-', '')),
  title text not null,
  report_type text not null default 'price',
  scope_type text not null default 'global' check (scope_type in ('global','route','customer','session')),
  route_id text references public.mcp_routes(id) on delete cascade,
  route_customer_id text references public.mcp_route_customers(id) on delete cascade,
  customer_id text,
  status text not null default 'active' check (status in ('active','hidden')),
  content text,
  price_summary text,
  competitor_summary text,
  display_summary text,
  stock_summary text,
  demand_summary text,
  opportunity_summary text,
  risk_summary text,
  next_action text,
  sort_order integer not null default 0,
  note text,
  raw_payload jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_mcp_competitors_route_status on public.mcp_competitors(route_id, status);
create index if not exists idx_mcp_customer_products_context on public.mcp_customer_products(route_id, route_customer_id, customer_id, status);
create index if not exists idx_mcp_report_templates_context on public.mcp_report_templates(report_type, scope_type, route_id, route_customer_id, customer_id, status);

create or replace function public.mcp_get_report_templates(
  p_report_type text default null,
  p_route_id text default null,
  p_customer_id text default null,
  p_route_customer_id text default null
)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.rank, t.sort_order, t.title), '[]'::jsonb)
  from (
    select
      id,
      title,
      report_type as "reportType",
      scope_type as "scopeType",
      route_id as "routeId",
      route_customer_id as "routeCustomerId",
      customer_id as "customerId",
      content,
      price_summary as "priceSummary",
      competitor_summary as "competitorSummary",
      display_summary as "displaySummary",
      stock_summary as "stockSummary",
      demand_summary as "demandSummary",
      opportunity_summary as "opportunitySummary",
      risk_summary as "riskSummary",
      next_action as "nextAction",
      sort_order,
      note,
      case scope_type when 'customer' then 1 when 'session' then 2 when 'route' then 3 else 4 end as rank
    from public.mcp_report_templates
    where status = 'active'
      and (p_report_type is null or p_report_type = '' or report_type = p_report_type)
      and (
        scope_type = 'global'
        or (scope_type = 'route' and route_id = p_route_id)
        or (scope_type in ('customer','session') and (
          (p_customer_id is not null and customer_id = p_customer_id)
          or (p_route_customer_id is not null and route_customer_id = p_route_customer_id)
        ))
      )
    union all
    select
      id,
      title,
      report_type as "reportType",
      'route_legacy' as "scopeType",
      route_id as "routeId",
      null::text as "routeCustomerId",
      null::text as "customerId",
      content,
      price_summary as "priceSummary",
      competitor_summary as "competitorSummary",
      display_summary as "displaySummary",
      stock_summary as "stockSummary",
      demand_summary as "demandSummary",
      opportunity_summary as "opportunitySummary",
      risk_summary as "riskSummary",
      next_action as "nextAction",
      999 as sort_order,
      note,
      5 as rank
    from public.mcp_route_report_templates
    where status = 'active'
      and route_id = p_route_id
      and (p_report_type is null or p_report_type = '' or report_type = p_report_type)
  ) t;
$$;

create or replace function public.mcp_get_report_context(p_session_customer_id text)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  sc record;
  competitors jsonb := '[]'::jsonb;
  products jsonb := '[]'::jsonb;
  templates jsonb := '[]'::jsonb;
begin
  select * into sc from public.mcp_session_customers where id = p_session_customer_id;
  if sc.id is null then
    raise exception 'session_customer_not_found' using errcode = '23503';
  end if;

  select coalesce(jsonb_agg(row_to_json(c)::jsonb order by c.sort_order, c."competitorName"), '[]'::jsonb)
    into competitors
  from (
    select id, competitor_name as "competitorName", brand_name as "brandName", category, area, route_id as "routeId", note, sort_order
    from public.mcp_competitors
    where status = 'active'
      and (route_id is null or route_id = sc.route_id)
      and (area is null or area = '' or sc.area is null or lower(area) = lower(sc.area))
    limit 50
  ) c;

  select coalesce(jsonb_agg(distinct row_to_json(p)::jsonb), '[]'::jsonb)
    into products
  from (
    select id, product_id as "productId", product_name as "productName", brand_name as "brandName", product_source as "source", note
    from public.mcp_customer_products
    where status = 'active'
      and (
        route_customer_id = sc.route_customer_id
        or (sc.customer_id is not null and customer_id = sc.customer_id)
        or (route_id = sc.route_id and customer_id is null and route_customer_id is null)
      )
    union
    select oi.id, oi.product_id as "productId", oi.product_name as "productName", null::text as "brandName", 'bought' as "source", oi.note
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where oi.product_name is not null
      and (
        (sc.customer_id is not null and o.customer_id = sc.customer_id)
        or lower(coalesce(o.customer_name, '')) = lower(coalesce(sc.customer_name, ''))
      )
    union
    select tr.id, tr.product_id as "productId", tr.product_name as "productName", null::text as "brandName", 'tested' as "source", tr.note
    from public.test_customer_results tr
    join public.test_customers tc on tc.id = tr.customer_id
    where tr.product_name is not null
      and (
        (sc.customer_id is not null and tc.id = sc.customer_id)
        or lower(coalesce(tc.customer_name, '')) = lower(coalesce(sc.customer_name, ''))
      )
    limit 80
  ) p;

  templates := public.mcp_get_report_templates(null, sc.route_id, sc.customer_id, sc.route_customer_id);

  return jsonb_build_object(
    'sessionCustomer', jsonb_build_object('id', sc.id, 'sessionId', sc.session_id, 'routeId', sc.route_id, 'routeCustomerId', sc.route_customer_id, 'customerId', sc.customer_id, 'customerName', sc.customer_name, 'area', sc.area),
    'competitors', competitors,
    'usedProducts', products,
    'templates', templates
  );
end;
$$;
