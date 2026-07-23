# Deploy trigger - UI audit fixes

Purpose: trigger Vercel production deployment after UI audit fixes.

Included in latest UI cleanup commits:

- Harden mobile scroll behavior across UI.
- Relax bottom sheet touch handling.
- Remove broken default PDF export links.
- Fix session PDF export link.
- Remove broken MCP sessions PDF group.
- Stabilize export menu layout on mobile.

Expected smoke checks after deployment is READY:

```text
/routes
/mcp
/mcp/sessions
/visits
/reports
/field-checks
/api/mcp-sessions?dateFrom=2026-07-01&dateTo=2026-07-31
/api/backend/exports/mcp-sessions.csv
/api/backend/exports/tests.csv
/api/pdf/session-day
```
