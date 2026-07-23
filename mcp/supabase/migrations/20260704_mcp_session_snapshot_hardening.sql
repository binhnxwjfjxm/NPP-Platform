-- MCP Gate 3: harden session snapshot integrity
-- Mirrors the production Supabase hardening applied on 2026-07-04.

-- A session can only snapshot a route customer once.
-- route_customer_id stays nullable so manually-added session customers remain supported.
create unique index if not exists mcp_session_customers_session_route_customer_uidx
on public.mcp_session_customers(session_id, route_customer_id)
where route_customer_id is not null;

-- Remove older duplicate unique-index name if it exists in another environment.
drop index if exists public.ux_mcp_session_customers_session_route_customer;

-- Speed up MCP visit lookups by route.
create index if not exists idx_mcp_visits_route_id
on public.mcp_visits(route_id);

-- Add missing MCP foreign keys idempotently.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'mcp_route_sessions_route_id_fkey'
      and conrelid = 'public.mcp_route_sessions'::regclass
  ) then
    alter table public.mcp_route_sessions
      add constraint mcp_route_sessions_route_id_fkey
      foreign key (route_id) references public.mcp_routes(id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'mcp_visits_session_id_fkey'
      and conrelid = 'public.mcp_visits'::regclass
  ) then
    alter table public.mcp_visits
      add constraint mcp_visits_session_id_fkey
      foreign key (session_id) references public.mcp_route_sessions(id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'mcp_visits_route_id_fkey'
      and conrelid = 'public.mcp_visits'::regclass
  ) then
    alter table public.mcp_visits
      add constraint mcp_visits_route_id_fkey
      foreign key (route_id) references public.mcp_routes(id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'mcp_visits_route_customer_id_fkey'
      and conrelid = 'public.mcp_visits'::regclass
  ) then
    alter table public.mcp_visits
      add constraint mcp_visits_route_customer_id_fkey
      foreign key (route_customer_id) references public.mcp_route_customers(id);
  end if;
end $$;
