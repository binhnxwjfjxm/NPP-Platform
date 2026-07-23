-- MCP Gate 5 A3: require session context for MCP write rows.
-- Missing session context must fail at DB level instead of silently creating orphan rows.

alter table public.mcp_session_customers
  alter column session_id set not null;

alter table public.mcp_visits
  alter column session_id set not null;

alter table public.mcp_followups
  alter column session_id set not null,
  alter column session_customer_id set not null;
