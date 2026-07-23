create table if not exists public.mcp_followups (
  id text primary key,
  session_id text not null references public.mcp_route_sessions(id),
  session_customer_id text not null references public.mcp_session_customers(id),
  visit_id text null references public.mcp_visits(id),
  route_id text null references public.mcp_routes(id),
  route_customer_id text null references public.mcp_route_customers(id),
  customer_id text null,
  customer_name text not null,
  followup_type text not null default 'general' check (followup_type in ('general','order','test','report','debt','support')),
  title text not null,
  due_date date null,
  status text not null default 'open' check (status in ('open','done','cancelled')),
  priority text not null default 'medium' check (priority in ('low','medium','high')),
  owner text null,
  note text null,
  raw_payload jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists mcp_followups_session_customer_idx on public.mcp_followups(session_customer_id, status);
create index if not exists mcp_followups_session_idx on public.mcp_followups(session_id, status);
create index if not exists mcp_followups_due_date_idx on public.mcp_followups(due_date, status);

alter table public.mcp_followups enable row level security;

drop policy if exists "service_role_manage_mcp_followups" on public.mcp_followups;
create policy "service_role_manage_mcp_followups"
  on public.mcp_followups
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
