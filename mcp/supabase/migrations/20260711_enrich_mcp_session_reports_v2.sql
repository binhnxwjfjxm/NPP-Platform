alter table public.mcp_session_reports
  add column if not exists schema_version text not null default 'mcp.session-report.snapshot.v2',
  add column if not exists customer_details jsonb not null default '[]'::jsonb,
  add column if not exists insights jsonb not null default '{}'::jsonb,
  add column if not exists score integer not null default 0,
  add column if not exists health text not null default 'unknown',
  add column if not exists warnings jsonb not null default '[]'::jsonb,
  add column if not exists recommended_actions jsonb not null default '[]'::jsonb,
  add column if not exists ai_prompt_context jsonb not null default '{}'::jsonb,
  add column if not exists ai_result jsonb,
  add column if not exists ai_analyzed_at timestamptz;

alter table public.mcp_session_reports
  drop constraint if exists mcp_session_reports_score_range;

alter table public.mcp_session_reports
  add constraint mcp_session_reports_score_range
  check (score >= 0 and score <= 100);

create index if not exists idx_mcp_session_reports_health
  on public.mcp_session_reports (health);

create index if not exists idx_mcp_session_reports_ai_analyzed_at
  on public.mcp_session_reports (ai_analyzed_at desc);
