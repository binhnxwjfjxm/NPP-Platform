# Backend API Phase 7

Goal: align frontend screens with backend read endpoints, then replace in-memory mock data with Supabase read queries while keeping the same API contracts.

## Current completed endpoints

```text
GET /api/dashboard/summary
GET /api/dashboard/overview
GET /api/routes
GET /api/routes/data
GET /api/routes/customers/data
GET /api/mcp-day/current
GET /api/mcp-day/data
GET /api/orders
GET /api/tests
GET /api/market-checks
GET /api/market-checks/data
GET /api/actions
GET /api/actions/data
```

These endpoints return wrapped payloads:

```json
{
  "data": {},
  "receivedAt": "2026-07-03T00:00:00.000Z"
}
```

The frontend API client recognizes this shape and marks the result as `source: api`.

## Current backend data mode

```text
Supabase live read mode.
```

The backend now reads from Supabase using server-side service-role credentials and maps the rows back to the existing frontend DTO contracts.

Required VPS env:

```env
SUPABASE_URL=https://noiadkpkvdohljgopgfb.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<server-only-service-role-key>
```

Do not put `SUPABASE_SERVICE_ROLE_KEY` in Vercel/frontend env.

If backend env is missing, data endpoints return:

```json
{
  "ok": false,
  "service": "mcp-plan-backend",
  "error": "missing_supabase_config"
}
```

This is intentional. Do not silently fake live data.

## Tables currently read

```text
mcp_routes
mcp_route_customers
mcp_route_sessions
mcp_visits
orders
order_items
test_customer_results
test_customers
```

`market_reports` currently has no rows, so market/test screens are driven from product test result data for now.

`actions` is currently derived from live read data: pending MCP lines, open orders, and test results needing attention. A dedicated task table/write flow should be added later.

## VPS deploy

From local, sync upstream to origin first, then deploy backend on VPS using the existing backend deploy script.

On VPS:

```bash
/var/www/deploy-mcp-backend.sh
```

## Env check on VPS

```bash
cd /var/www/mcp-plan-backend
node -e "require('dotenv').config?.(); console.log(Boolean(process.env.SUPABASE_URL), Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY))"
```

If dotenv is not installed or the command is inconvenient, inspect the runtime env safely:

```bash
pm2 env mcp-plan-backend | grep SUPABASE
```

Do not print the service-role key value in logs or chat.

## Quick checks on VPS

```bash
curl -fsS http://127.0.0.1:3001/api/health
curl -fsS http://127.0.0.1:3001/api/dashboard/summary
curl -fsS http://127.0.0.1:3001/api/dashboard/overview
curl -fsS http://127.0.0.1:3001/api/routes
curl -fsS http://127.0.0.1:3001/api/routes/data
curl -fsS http://127.0.0.1:3001/api/routes/customers/data
curl -fsS http://127.0.0.1:3001/api/mcp-day/current
curl -fsS http://127.0.0.1:3001/api/mcp-day/data
curl -fsS http://127.0.0.1:3001/api/orders
curl -fsS http://127.0.0.1:3001/api/tests
curl -fsS http://127.0.0.1:3001/api/market-checks/data
curl -fsS http://127.0.0.1:3001/api/actions/data

curl -fsS http://165.22.109.61/api/dashboard/summary
curl -fsS http://165.22.109.61/api/dashboard/overview
curl -fsS http://165.22.109.61/api/routes/data
curl -fsS http://165.22.109.61/api/routes/customers/data
curl -fsS http://165.22.109.61/api/mcp-day/data
curl -fsS http://165.22.109.61/api/orders
curl -fsS http://165.22.109.61/api/tests
curl -fsS http://165.22.109.61/api/actions/data
```

Expected dashboard summary shape:

```json
{
  "data": {
    "routeCount": 8,
    "accountCount": 51,
    "visitCount": 73,
    "orderAmount": 403000,
    "actionCount": 9
  },
  "receivedAt": "..."
}
```

Values are live and may change as Supabase rows change.

Expected dashboard overview shape:

```text
data.kpis
data.routeHealth
data.actions
data.insights
receivedAt
```

Expected routes list shape:

```text
data[]
data[].id
data[].name
data[].area
data[].owner
data[].active
receivedAt
```

Expected routes data shape:

```text
data.kpis
data.routes
receivedAt
```

Expected route customers data shape:

```text
data.kpis
data.customers
data.customers[].routeId
data.customers[].accountName
data.customers[].status
data.customers[].gps optional
receivedAt
```

Expected MCP current day shape:

```text
data.id
data.routeName
data.date
data.owner
data.status
receivedAt
```

Expected MCP day data shape:

```text
data.run
data.kpis
data.lines
data.results
receivedAt
```

Important MCP note:

```text
There is still no mcp_session_customers snapshot table.
Current read mapping builds MCP day lines from route customers plus visits for the latest session.
The proper snapshot table is still required before backend write flow.
```

Expected orders shape:

```text
data[]
data[].id
data[].code
data[].date
data[].accountName
data[].routeName
data[].owner
data[].source
data[].skuCount
data[].quantity
data[].totalAmount
data[].status
receivedAt
```

Expected tests and market checks data shape:

```text
data.kpis
data.checks
data.checks[].id
data.checks[].date
data.checks[].routeName
data.checks[].accountName
data.checks[].productName
data.checks[].competitorName
data.checks[].shelfPrice
data.checks[].stockStatus
data.checks[].note
data.checks[].status
receivedAt
```

Expected actions list shape:

```text
data[]
data[].id
data[].title
data[].owner
data[].priority
data[].status
data[].dueDate
receivedAt
```

Expected actions data shape:

```text
data.kpis
data.items
data.items[].id
data.items[].title
data.items[].accountName
data.items[].routeName
data.items[].owner
data.items[].source
data.items[].priority
data.items[].status
data.items[].dueDate
data.items[].note
receivedAt
```

Supported query params:

```text
status
priority
search
routeId
```

## Next backend work

```text
1. Deploy and verify Supabase live read endpoints on VPS.
2. Add mcp_session_customers snapshot table/migration after orphan/schema audit.
3. Add backend write APIs module by module.
4. Move browser writes to backend-owned endpoints.
5. Tighten Supabase RLS only after backend write flow is verified.
```

## Important rule

This phase only adds read endpoints first. Do not tighten Supabase RLS or move browser writes until backend write APIs exist and are tested.
