# Phase 8 - MCP backend write flow

Ngay bat dau: 2026-07-03

## 1. Phase goal

Build the MCP daily-session write flow correctly before tightening RLS or moving browser writes.

This phase must preserve the core business rule:

```text
Route Master
  -> Route Customer Master
  -> Daily Session
  -> Session Customer Snapshot
  -> Visit Result / Order / Test / Report / Follow-up
```

## 2. Handoff basis

From `docs/HANDOFF_SUMMARY.md`, the correct next sequence is:

```text
1. Verify all Supabase live read endpoints after deploy.
2. Audit DB relationship/orphan data for MCP route/session/visit group.
3. Design migration for mcp_session_customers.
4. Add backend write endpoint: open MCP daily session creates session customer snapshot.
5. Add backend write endpoint: update session customer status / visit result.
6. Move orders/tests/reports/follow-up creation from MCP customer card to backend-owned APIs.
7. Then tighten Supabase RLS.
```

## 3. Audit result

Supabase project:

```text
noiadkpkvdohljgopgfb
```

Live counts checked:

| Entity | Count |
|---|---:|
| `mcp_routes` | 8 |
| `mcp_route_customers` | 51 |
| `mcp_route_sessions` | 7 |
| `mcp_visits` | 73 |
| `orders` | 2 |
| `order_items` | 3 |

Orphan checks:

| Check | Orphan count |
|---|---:|
| `mcp_route_customers.route_id -> mcp_routes.id` | 0 |
| `mcp_route_sessions.route_id -> mcp_routes.id` | 0 |
| `mcp_visits.session_id -> mcp_route_sessions.id` | 0 |
| `mcp_visits.route_customer_id -> mcp_route_customers.id` | 0 |
| `order_items.order_id -> orders.id` | 0 |

Conclusion: current data is clean enough to add a new snapshot table with FK references. Do not add FK constraints to old tables in this same step; keep that as a later hardening migration.

## 4. Migration added

Created migration file:

```text
supabase/migrations/20260703_add_mcp_session_customers.sql
```

This migration creates:

```text
public.mcp_session_customers
```

Purpose:

```text
One row = one planned customer line inside one opened MCP daily session.
```

Important columns:

| Column | Role |
|---|---|
| `session_id` | The daily MCP session. |
| `route_id` | Route copied into the snapshot. |
| `route_customer_id` | Original route customer when source is `master`. |
| `customer_name`, `phone`, `area`, `address` | Copied customer fields. |
| `source` | `master` or `added`. |
| `planned_status` | `planned`, `added`, `removed`. |
| `visit_status` | `pending`, `visited`, `skipped`, `cancelled`. |
| `status_reason` | Required when skipped/cancelled. |
| `visit_id`, `order_id`, `test_id`, `report_id` | Links to generated work from the MCP card. |

## 5. Why this design is correct

`mcp_visits` must stay as actual result data only. It is not the planned customer list.

The new snapshot table solves these problems:

1. Opening a daily MCP session freezes the customer list for that day.
2. Editing route master later does not mutate already-opened sessions.
3. Customers added during the day can be tracked with `source = added`.
4. Skipped/cancelled customers require a reason.
5. Orders/tests/reports created from an MCP card can attach to the session customer line.

## 6. Next code step

Add backend write endpoint:

```text
POST /api/mcp-day/open-session
```

Suggested request:

```json
{
  "routeId": "route-id",
  "sessionDate": "2026-07-03",
  "owner": "sales name optional"
}
```

Required behavior:

1. Validate `routeId` exists and is active.
2. Reuse existing session when `route_id + session_date` already exists.
3. If session is new, insert into `mcp_route_sessions`.
4. Insert snapshot rows into `mcp_session_customers` from active `mcp_route_customers` for that route.
5. Do not duplicate snapshot rows if endpoint is called twice.
6. Return the same wrapped response shape as read endpoints:

```json
{
  "data": {
    "session": {},
    "snapshotCount": 0
  },
  "receivedAt": "..."
}
```

## 7. SQL insert logic for snapshot

Use this logic inside the backend endpoint after session creation/reuse:

```sql
insert into public.mcp_session_customers (
  id,
  session_id,
  route_id,
  route_customer_id,
  customer_id,
  customer_name,
  phone,
  area,
  address,
  sort_order,
  source,
  planned_status,
  visit_status,
  raw_payload
)
select
  'msc_' || replace(gen_random_uuid()::text, '-', ''),
  :session_id,
  rc.route_id,
  rc.id,
  rc.customer_id,
  rc.customer_name,
  rc.phone,
  rc.area,
  rc.address,
  coalesce(rc.sort_order, 0),
  'master',
  'planned',
  'pending',
  jsonb_build_object('route_customer_snapshot', to_jsonb(rc))
from public.mcp_route_customers rc
where rc.route_id = :route_id
  and coalesce(rc.active, true) = true
on conflict do nothing;
```

Note: if `gen_random_uuid()` is unavailable, enable `pgcrypto` first or generate IDs in backend code.

## 8. Endpoint contract after snapshot exists

After migration and open-session endpoint, update `GET /api/mcp-day/data` to prefer:

```text
mcp_session_customers + mcp_visits
```

instead of:

```text
mcp_route_customers + mcp_visits
```

Fallback to old read mapping only while no snapshot exists for old sessions.

## 9. Do not do yet

Do not tighten RLS yet.
Do not move order/test/report writes yet.
Do not create random write endpoints outside the MCP session flow.
Do not hard-delete opened session customer lines.
