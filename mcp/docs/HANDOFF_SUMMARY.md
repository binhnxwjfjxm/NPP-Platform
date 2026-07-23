# MCP-Plan Handoff Summary

Use this file to continue work in a new chat.

## User working rule

```text
Khong chap va khi loi. Phai tim nguyen nhan va sua dung logic/layer.
```

Preferred style:

```text
Tra loi ngan, thang, co lenh copy-paste khi can.
```

## Repos

Upstream/source repo:

```text
https://github.com/gustavjung01/MCP-Plan.git
```

Origin/live Vercel repo:

```text
https://github.com/minhmannguyengdp-sketch/MCP-Plan.git
```

Local path:

```powershell
F:\1_A_Disk_D\Tool\mcp-plan
```

Standard local sync/build/push:

```powershell
cd "F:\1_A_Disk_D\Tool\mcp-plan"

git fetch upstream
git reset --hard upstream/main

npm install
npm run build

git push origin main --force-with-lease
```

## VPS backend

```text
Server: backend-DO-02
IP: 165.22.109.61
Runtime dir: /var/www/mcp-plan-backend
Source dir: /var/www/mcp-plan-source
PM2 app: mcp-plan-backend
Internal API: http://127.0.0.1:3001
Public API: http://165.22.109.61
```

Deploy backend on VPS:

```bash
/var/www/deploy-mcp-backend.sh
```

Restart/check:

```bash
pm2 restart mcp-plan-backend --update-env
pm2 save
curl -fsS http://127.0.0.1:3001/api/health
```

Expected health after env is loaded:

```json
{
  "ok": true,
  "supabase": "configured"
}
```

Do not print secrets in chat.

## Supabase

```text
Project ref: noiadkpkvdohljgopgfb
Project URL: https://noiadkpkvdohljgopgfb.supabase.co
```

Backend `.env` on VPS must contain:

```env
NODE_ENV=production
HOST=127.0.0.1
PORT=3001
SUPABASE_URL=https://noiadkpkvdohljgopgfb.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<server-side key only>
CORS_ORIGINS=*
```

Current backend reads Supabase via REST/fetch. `DATABASE_URL` is not needed yet.

## Frontend env

Vercel should have:

```text
NEXT_PUBLIC_API_BASE_URL=http://165.22.109.61
```

Do not put server secrets in Vercel/frontend env.

## Current backend read endpoints

All data endpoints return:

```json
{
  "data": {},
  "receivedAt": "..."
}
```

Completed endpoints:

```text
GET /api/health
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

Live read tables currently mapped:

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

Important limitation:

```text
mcp_session_customers table does not exist yet.
Current /api/mcp-day/data builds lines from route customers + visits for latest session.
Before write flow, add a proper session customer snapshot table.
```

## Backend live endpoint checks

Run on VPS:

```bash
curl -fsS http://127.0.0.1:3001/api/health
curl -fsS http://127.0.0.1:3001/api/dashboard/summary
curl -fsS http://127.0.0.1:3001/api/dashboard/overview
curl -fsS http://127.0.0.1:3001/api/routes/data
curl -fsS http://127.0.0.1:3001/api/routes/customers/data
curl -fsS http://127.0.0.1:3001/api/mcp-day/data
curl -fsS http://127.0.0.1:3001/api/orders
curl -fsS http://127.0.0.1:3001/api/tests
curl -fsS http://127.0.0.1:3001/api/actions/data
```

Public checks:

```bash
curl -fsS http://165.22.109.61/api/dashboard/summary
curl -fsS http://165.22.109.61/api/routes/data
curl -fsS http://165.22.109.61/api/mcp-day/data
curl -fsS http://165.22.109.61/api/orders
```

## UI compact work done

Dashboard:

```text
Added 4 module cards: MCP / Don / Test / Bao cao.
Kept useful current dashboard parts: today summary, KPI strip, actions, route health, API source.
```

Navigation:

```text
Mobile bottom nav reduced to 5: Tong / MCP / Don / Test / Plan.
Desktop sidebar still has full modules.
```

Cards:

```text
Created OperationalListCard.
Applied compact list card to MCP, Routes, Orders, Test, Reports.
Added compact-operational.css override for lower card height and balanced horizontal actions.
```

UI is acceptable for now but not final. Continue polishing later after backend write flow.

## Key docs

```text
docs/IMPLEMENTATION_PLAN.md
docs/DB_AUDIT.md
docs/API_PLAN.md
docs/BACKEND_API_PHASE7.md
docs/VPS_BACKEND_HANDOFF.md
docs/UI_COMPACT_AUDIT.md
docs/UI_REFERENCE_REPORT.md
```

## Next major phase

Do not tighten RLS yet. Do not start random write endpoints yet.

Correct next sequence:

```text
1. Verify all Supabase live read endpoints after deploy.
2. Audit DB relationship/orphan data for MCP route/session/visit group.
3. Design migration for mcp_session_customers.
4. Add backend write endpoint: open MCP daily session creates session customer snapshot.
5. Add backend write endpoint: update session customer status / visit result.
6. Move orders/tests/reports/follow-up creation from MCP customer card to backend-owned APIs.
7. Then tighten Supabase RLS.
```

## MCP business rules

```text
Route Master
  -> Route Customer Master
  -> Daily Session
  -> Session Customer Snapshot
  -> Visit Result / Order / Test / Report / Follow-up
```

Rules:

```text
1. Opening a daily MCP session creates customer snapshots.
2. Editing route master after session opens must not mutate that session snapshot automatically.
3. Customers added during the day use source = added.
4. Do not hard delete customers from an opened session.
5. Skipping/cancelling a customer requires a reason.
6. mcp_visits stores actual visit results only.
7. mcp_visits is not the planned customer list.
8. Orders/tests/reports/tasks must attach to the session customer snapshot when they originate from a daily MCP card.
```

## Current risk list

```text
1. RLS policies are still permissive for anon writes.
2. public.rls_auto_enable() and set_updated_at need security hardening later.
3. mcp_session_customers is missing.
4. Actions are derived from live reads, no dedicated action table/write flow yet.
5. Some UI labels/docs still need final Vietnamese polish.
```
