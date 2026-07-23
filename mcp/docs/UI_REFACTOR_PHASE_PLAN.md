# UI Refactor Phase Plan - MCP-Plan

Goal: recycle useful presentation patterns from the old report app, then improve them into clean MCP-Plan React UI.

Do not copy old report logic, old CSS hacks, DOM mutation, IndexedDB flow, or direct Supabase write flow.

## Working rule

Each phase must be small and testable.

```text
1 phase = 1 screen or 1 shared component group
1 change must have a clear before/after
No unrelated logic changes during UI refactor
No DB/schema change unless the backend contract requires it
```

## Phase 0 - Lock current contracts

### Purpose

Prevent UI refactor from breaking runtime/API direction.

### Scope

```text
NEXT_PUBLIC_API_BASE_URL client path
backend fallback/mock behavior
VPS backend health path
mobile bottom nav safe-area treatment
```

### Files

```text
src/lib/api/api-client.ts
apps/backend/server.js
src/app/mobile-nav-tune.css
```

### Done when

```text
Frontend still builds.
Dashboard still renders if backend endpoint is missing.
Backend health still returns ok.
Mobile bottom nav remains app-like and does not jump.
```

Status: started.

## Phase 1 - Dashboard cleanup

### Purpose

Make dashboard readable within 5 seconds.

### Reference from old report

```text
Today summary
compact KPI block
small operational cards
action list
```

### Improve for MCP-Plan

```text
Show source badge: API thật / Mock
Today summary first
2-column KPI strip on mobile
Route health as cards instead of desktop table
Priority actions as compact list
```

### Files

```text
src/features/dashboard/DashboardPage.tsx
src/ui/cards/KpiCard.tsx
src/app/polish.css
src/app/mobile.css if needed
```

### Do not do

```text
Do not add new business logic.
Do not make frontend aggregate complex data.
Do not copy old report CSS.
```

### Done when

```text
Dashboard mobile has no dense table as primary view.
Each card has one clear purpose.
KPI strip is compact.
Actions are visible without hunting.
```

Status: completed in UI pass.

### Completed changes

```text
Dashboard now starts with Today summary.
KPI strip is compact and mobile 2-column.
Priority actions are shown before route health.
Route health uses cards with progress bars instead of a desktop table.
Dashboard still uses API client fallback and does not add business write logic.
```

## Phase 2 - Shared UI primitives

### Purpose

Avoid per-screen CSS hacks. Build reusable presentation pieces.

### Components to create or improve

```text
TodaySummaryCard
CompactKpiStrip
StatusChipBar
OperationalListCard
ActionButtonRow
SourceBadge
SyncStatePill
```

### Files

```text
src/ui/cards/*
src/ui/layout/*
src/ui/status/*
src/app/polish.css
```

### Done when

```text
Dashboard uses at least 2 shared primitives.
MCP day/session can reuse them without duplicating CSS.
```

## Phase 3 - MCP daily/session screen

### Purpose

This is the core business screen. Make it fast for field use.

### Reference from old report

```text
route hero
score pills
status chip filters
customer cards
action row per customer
```

### Improve for MCP-Plan

```text
Session status visible
Snapshot source visible: planned / added
Customer status badge standardized
Actions grouped by workflow: visit, order, test, follow-up
Skip/cancel requires reason later through backend
No hard delete from opened session
```

### Files

Likely files to inspect/update:

```text
src/features/mcp-day/*
src/features/mcp/*
src/ui/cards/*
src/lib/api/api-client.ts
src/lib/api/api.types.ts
```

### Backend dependency

This screen should eventually use:

```text
GET /api/route-sessions
GET /api/route-sessions/:id/customers
GET /api/visits
```

Until backend is ready, mock fallback is allowed.

### Done when

```text
A sales user can see today's route/session immediately.
Customer list is card-based on mobile.
Filters are horizontal chips.
Each customer card has predictable actions.
```

## Phase 4 - Orders screen

### Purpose

Make orders easy to scan by source and status.

### Reference from old report

```text
compact order cards
status badge
quick actions
```

### Improve for MCP-Plan

```text
Order source shown first: MCP / visit / phone
Customer + route context first
Amount + item count compact
Clear status: draft / confirmed / delivered / cancelled
```

### Files

```text
src/features/orders/*
src/lib/api/api-client.ts
src/lib/api/api.types.ts
```

### Done when

```text
Mobile order list no longer feels like a desktop table.
User can identify order source and status without opening detail.
```

## Phase 5 - Test product screen

### Purpose

Keep test workflow clear without overcrowding buttons.

### Reference from old report

```text
test file card
customer result list
small result action buttons
```

### Improve for MCP-Plan

```text
Separate test file setup from result entry
Show product count
Show customer count
Show pending/completed result count
Avoid tiny buttons for complex actions
```

### Files

```text
src/features/market-checks/* or test module files when present
src/lib/api/api-client.ts
src/lib/api/api.types.ts
```

### Done when

```text
Test file list is compact.
Result entry path is obvious.
No screen forces the user to read too much text.
```

## Phase 6 - Market report / field check

### Purpose

Make field observations quick to capture and review.

### Reference from old report

```text
report module entry
basic report cards
```

### Improve for MCP-Plan

```text
field check templates
competitor / price / display / stock status
photo evidence slot later
follow-up task creation later
```

### Files

```text
src/features/market-checks/*
src/features/actions/*
src/lib/api/api-client.ts
```

### Done when

```text
Market checks are not mixed with dashboard noise.
Each report card shows type, customer/route, and next action.
```

## Phase 7 - Backend real data alignment

### Purpose

Replace mock/fallback screen by screen with backend data.

### Order

```text
1. /api/dashboard/summary
2. /api/dashboard/overview
3. /api/routes
4. /api/routes/:id/customers
5. /api/route-sessions
6. /api/visits
7. /api/orders
8. /api/tests
9. /api/market-checks
10. /api/actions
```

### Rule

```text
Backend owns aggregation and business logic.
Frontend only presents normalized DTOs.
```

### Done when

```text
Each screen shows source = api.
Mock remains only for local development or fallback.
```

## Suggested working sequence

```text
A. Finish Dashboard visual pass.
B. Extract shared primitives from Dashboard.
C. Refactor MCP daily/session screen.
D. Add backend read endpoints for Dashboard + MCP session.
E. Refactor Orders.
F. Refactor Test.
G. Refactor Market report.
H. Tighten Supabase RLS only after write flow is backend-owned.
```

## Test checklist per phase

```text
npm run typecheck
npm run build
Mobile iPhone visual check
Desktop basic check
No service role exposed in frontend
No direct Supabase write added to browser
```
