# Gate 5 - Session history real aggregate endpoint

Goal: `/mcp/sessions` must read real session history from one aggregate endpoint, not call session-status once per route.

## Status in repo

Implemented:

- `src/app/api/mcp-sessions/route.ts`
  - Reads `mcp_route_sessions` directly.
  - Reads `mcp_routes` once for filter options / fallback route names.
  - Reads `mcp_session_customers` once for all scoped session IDs using a PostgREST `in.(...)` filter.
  - Aggregates planned, visited, order, test, report, follow-up counts by `session_id`.
  - No N+1 calls to `/api/backend/mcp-settings/session-status`.

- `src/lib/export/supabase-rest.ts`
  - Allows raw PostgREST filter prefixes including `in.`, `neq.`, `like.`, `is.`.

## Test checklist after deploy

```text
/mcp/sessions
/api/mcp-sessions?dateFrom=2026-07-01&dateTo=2026-07-31
/api/mcp-sessions?routeId=<routeId>
/api/mcp-sessions?status=active
/api/mcp-sessions?status=done
/api/mcp-sessions?status=cancelled
```

Expected:

```text
- Session list comes from mcp_route_sessions.
- KPI visited/planned comes from mcp_session_customers when rows exist.
- No per-route session-status loop.
```

## Deployment note

Vercel ignored-build setting was reopened by the owner. This docs-only commit is intentionally used to trigger production deploy after Gate 1-5.
