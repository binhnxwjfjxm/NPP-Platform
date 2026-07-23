-- MCP Gate 5 database hardening.
-- One route can only have one session per day.

create unique index if not exists mcp_route_sessions_route_date_uidx
on public.mcp_route_sessions(route_id, session_date);
