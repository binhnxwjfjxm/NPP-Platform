# VPS Backend Handoff - MCP-Plan

## 1. VPS runtime contract

```text
VPS name: backend-DO-02
Public IP: 165.22.109.61
SSH user: deploy
App path: /var/www/mcp-plan-backend
PM2 app name: mcp-plan-backend
Backend internal host: 127.0.0.1
Backend internal port: 3001
Public proxy: Nginx port 80 -> 127.0.0.1:3001
```

Backend thật phải giữ nguyên contract:

```text
App listen: 127.0.0.1:3001
Public HTTP: qua Nginx
Process manager: PM2
Secrets: chỉ nằm ở VPS/backend
Frontend: chỉ gọi API base URL
```

Không expose trực tiếp port `3001` ra public nếu không cần.

## 2. Quick checks on VPS

```bash
ssh deploy@165.22.109.61
cd /var/www/mcp-plan-backend

pm2 status
pm2 logs mcp-plan-backend --lines 100

curl http://127.0.0.1:3001
curl http://127.0.0.1:3001/health
curl http://127.0.0.1:3001/api/health
curl http://165.22.109.61

sudo nginx -t
sudo systemctl status nginx
```

## 3. Deploy/restart backend

```bash
cd /var/www/mcp-plan-backend

npm install
npm run build

pm2 restart mcp-plan-backend
pm2 save
```

If PM2, Nginx, or API fails, inspect logs and fix the root cause. Do not change ports randomly to bypass the issue.

## 4. Health endpoints

Backend should provide at least:

```text
GET /health
GET /api/health
```

Expected shape:

```json
{
  "ok": true,
  "service": "mcp-plan-backend",
  "time": "2026-07-03T00:00:00.000Z"
}
```

## 5. Environment variables on VPS

```env
NODE_ENV=production
HOST=127.0.0.1
PORT=3001
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_ANON_KEY=
DATABASE_URL=
CORS_ORIGINS=
```

Rules:

```text
SUPABASE_SERVICE_ROLE_KEY only lives on backend/VPS.
Do not put service role key in Vercel frontend.
Do not commit .env files.
Frontend receives only API base URL.
```

## 6. Frontend contract

Frontend repo should call backend through an API base URL:

```text
NEXT_PUBLIC_API_BASE_URL=http://165.22.109.61
```

Later with domain/SSL:

```text
NEXT_PUBLIC_API_BASE_URL=https://api.example.com
```

Frontend should not import Supabase service-role clients. Dashboard, route/session, visit, test, order, and plan aggregations must be handled by backend APIs.

## 7. Backend responsibility

Backend owns:

```text
Auth / user / role
Route master
Route customers
MCP daily session
MCP session customer snapshot
Visit result
Orders from MCP customer card
Product test from MCP customer card
Market report / field check
Follow-up task / plan
Dashboard summary API
```

## 8. MCP business rules

```text
1. Opening a daily MCP session creates customer snapshots.
2. Editing route master after a session opens must not mutate that session snapshot automatically.
3. Customers added during the day use source = added.
4. Do not hard delete customers from an opened session.
5. Skipping/cancelling a customer requires a reason.
6. mcp_visits stores actual visit results only.
7. mcp_visits is not the planned customer list.
8. Orders/tests/reports/tasks must attach to the session customer snapshot when they originate from a daily MCP card.
```

Recommended middle table:

```text
mcp_session_customers
```

It sits between:

```text
mcp_route_sessions
mcp_visits
```

## 9. Supabase hardening sequence

Do not tighten RLS blindly before backend write APIs are ready.

Correct sequence:

```text
1. Move write operations to backend.
2. Verify backend uses service role only on server.
3. Verify frontend uses publishable/anon key only where safe.
4. Add/verify authenticated policies.
5. Revoke overly broad anon insert/update policies.
6. Fix SECURITY DEFINER function exposure.
7. Fix mutable search_path function warnings.
8. Re-run Supabase security/performance advisors.
```

## 10. Vercel responsibility

Vercel should stay light:

```text
Next.js frontend
UI rendering
Navigation
API client wrapper
No service role secret
No heavy dashboard aggregation
No direct complex Supabase write flow
```

This keeps the app smoother and makes business logic testable on the backend.
