-- MCP-Plan Phase 8
-- Add daily MCP session customer snapshot table.
-- Reason:
--   mcp_visits stores actual visit results only.
--   A daily session needs its own planned customer snapshot so later route-master edits
--   do not mutate already-opened MCP sessions.
--
-- Preflight checked on 2026-07-03:
--   route_customers_without_route = 0
--   sessions_without_route = 0
--   visits_without_session = 0
--   visits_without_route_customer = 0
--   order_items_without_order = 0
--
-- Rollback note:
--   drop table public.mcp_session_customers;

create table if not exists public.mcp_session_customers (
  id text primary key,

  session_id text not null references public.mcp_route_sessions(id),
  route_id text not null references public.mcp_routes(id),
  route_customer_id text references public.mcp_route_customers(id),

  customer_id text,
  customer_name text not null,
  phone text,
  area text,
  address text,
  sort_order integer default 0,

  source text not null default 'master',
  planned_status text not null default 'planned',
  visit_status text not null default 'pending',
  status_reason text,

  visit_id text references public.mcp_visits(id),
  order_id text,
  test_id text,
  report_id text,
  followup_count integer not null default 0,

  note text,
  raw_payload jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  constraint mcp_session_customers_source_check
    check (source in ('master', 'added')),

  constraint mcp_session_customers_planned_status_check
    check (planned_status in ('planned', 'added', 'removed')),

  constraint mcp_session_customers_visit_status_check
    check (visit_status in ('pending', 'visited', 'skipped', 'cancelled')),

  constraint mcp_session_customers_reason_required_check
    check (
      visit_status not in ('skipped', 'cancelled')
      or nullif(btrim(coalesce(status_reason, '')), '') is not null
    ),

  constraint mcp_session_customers_master_has_route_customer_check
    check (
      source <> 'master'
      or route_customer_id is not null
    )
);

create unique index if not exists ux_mcp_session_customers_session_route_customer
on public.mcp_session_customers(session_id, route_customer_id)
where route_customer_id is not null;

create index if not exists idx_mcp_session_customers_session_id
on public.mcp_session_customers(session_id);

create index if not exists idx_mcp_session_customers_route_id
on public.mcp_session_customers(route_id);

create index if not exists idx_mcp_session_customers_route_customer_id
on public.mcp_session_customers(route_customer_id);

create index if not exists idx_mcp_session_customers_visit_status
on public.mcp_session_customers(visit_status);

create index if not exists idx_mcp_session_customers_order_id
on public.mcp_session_customers(order_id)
where order_id is not null;

create index if not exists idx_mcp_session_customers_test_id
on public.mcp_session_customers(test_id)
where test_id is not null;

alter table public.mcp_session_customers enable row level security;

comment on table public.mcp_session_customers is
  'Daily MCP session customer snapshot. Route master edits must not mutate opened sessions automatically.';

comment on column public.mcp_session_customers.source is
  'master = copied from mcp_route_customers when session opened; added = added during the day.';

comment on column public.mcp_session_customers.visit_status is
  'pending, visited, skipped, cancelled. skipped/cancelled require status_reason.';
