# Gate 7 - Session report model

## Decision

MCP session is the source data file for the workday.

```text
mcp_route_sessions
= routeId + sessionDate + sessionId
= all session customers + orders + tests + observations + follow-ups + skip reasons
```

BC is not a standalone report created per customer.
BC must be a session-level summary generated from the active MCP session.

## Correct tree

```text
MCP route master
└─ MCP session / routeId + sessionDate + sessionId
   ├─ Customers in session
   │  ├─ Orders
   │  ├─ Tests
   │  ├─ Observations
   │  ├─ Follow-ups
   │  └─ Skip / no-buy reasons
   └─ Session report / BC phiên
      ├─ Overview
      ├─ Competitors
      ├─ Used products / brands
      ├─ Tests
      ├─ Orders
      ├─ Follow-ups
      ├─ Skip reasons
      ├─ Opportunities
      ├─ Risks
      └─ Next actions
```

## UX rule

Sales should not create a report and then choose a session manually.
The session already exists, so the report should auto-bind to that session.

```text
Open MCP session
→ visit customers
→ create orders / tests / observations / follow-ups / skips
→ BC phiên auto-updates from the session data
→ close session
→ snapshot official session report
```

## Gate 7A

Documented the model only. No database schema change in this step.

## Gate 7B

Renamed the per-customer report action to Observation / Quan sát.

Implemented:

- `src/features/mcp/mcp-customer-actions.ts`
  - `market_report` label changed from `Báo cáo` to `Quan sát`.
  - Description now explains that the input is quick observation data for later session report aggregation.

- `src/features/mcp/McpLineCard.tsx`
  - Customer action button changed from `Báo cáo` to `Quan sát`.
  - Customer result summary changed from `Có báo cáo` to `Có quan sát`.

- `src/features/mcp/McpMarketReportFields.tsx`
  - Popup copy changed from customer-level BC to `Quan sát thị trường`.
  - Clarifies that these fields are input data for BC phiên, not a final per-customer report.

## Gate 7C

Added `BC phiên` entry point on active `/visits`.

Implemented:

- `src/features/mcp/VisitsSessionReportPanel.tsx`
  - Adds a fixed `BC phiên` button next to the existing export control.
  - Opens a read-only bottom sheet bound to the current `mcpDayData.run.id`.
  - Does not require user to create/select a report manually.

- `src/features/mcp/McpSessionCompactView.tsx`
  - Mounts `VisitsSessionReportPanel` for the active visit session.

## Gate 7D

Added session report summary API by sessionId.

Implemented:

- `src/lib/mcp/session-report.ts`
  - Shared aggregation builder for live summary and official snapshot.

- `src/app/api/mcp-session-report/route.ts`
  - `GET` accepts `sessionId`; also supports `routeId + date` fallback.
  - `POST` can create/update a manual snapshot for one `sessionId`.

The aggregation reads:

```text
mcp_route_sessions
mcp_session_customers
market_reports
orders
test_customer_results
```

And outputs:

```text
overview
competitors
usedProducts
opportunities
risks
nextActions
observations
orders
tests
skipped
```

## Gate 7E

Polished the BC phiên popup into a read-only grouped summary.

Implemented:

- No inactive/non-working action buttons.
- Sections are grouped by business meaning, not raw rows.
- Customer-level Quan sát is shown only as input inside the session report.

## Gate 7F

Close-session creates the official snapshot.

Database:

```text
mcp_session_reports
```

Created columns:

```text
session_id
route_id
route_name
session_date
sales
status
snapshot_source
kpis
overview
sections
summary_text
raw_payload
snapshot_at
```

Implemented:

- `src/app/api/backend/mcp-session-actions/[id]/route.ts`
  - When status is updated to `done` or `completed`, the route calls `saveMcpSessionReportSnapshot`.
  - Snapshot is upserted by `session_id`, so repeated close actions update the official report instead of duplicating.

- `src/features/mcp/VisitsSessionReportPanel.tsx`
  - Adds `Chốt phiên` action in `/visits`.
  - Chốt phiên updates the session status and creates the snapshot.

## Gate 7G

`/reports` now reads session-level snapshots.

Implemented:

- `src/features/market-reports/MarketReportsPage.tsx`
  - Reads `mcp_session_reports`, not raw per-customer `market_reports`.

- `src/features/market-reports/MarketReportsClientPage.tsx`
  - UI copy changed to `Báo cáo phiên`.
  - Removed dead `Việc` / `Tạo việc xử lý` buttons.

## Compatibility kept

- Existing API route name remains `/api/backend/mcp-day/session-customer/report`.
- Existing action key remains `market_report`.
- Existing DB table `market_reports` remains the customer observation input source.

## Smoke checks

```text
/visits?routeId=<routeId>&date=<yyyy-mm-dd>
/api/mcp-session-report?sessionId=<sessionId>
/api/mcp-session-report?routeId=<routeId>&date=<yyyy-mm-dd>
/reports
```

Expected:

```text
- /visits shows BC phiên and Chốt phiên.
- Opening BC phiên does not ask user to create/select a report.
- The popup summarizes the current session by section.
- Chốt phiên creates/updates one mcp_session_reports row by session_id.
- /reports lists BC phiên snapshots, not customer-level observations.
```
