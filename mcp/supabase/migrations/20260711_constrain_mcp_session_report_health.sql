alter table public.mcp_session_reports
  drop constraint if exists mcp_session_reports_health_values;

alter table public.mcp_session_reports
  add constraint mcp_session_reports_health_values
  check (health in ('unknown', 'good', 'watch', 'risk'));
