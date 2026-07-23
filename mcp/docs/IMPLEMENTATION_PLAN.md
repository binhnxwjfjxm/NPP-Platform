# Implementation Plan - MCP-Plan

## Muc tieu

Xay dung MCP-Plan dua tren Supabase DB hien co, uu tien route/test/order dang co data that. Khong bat dau bang frontend dep mat khi backend contract va DB logic chua ro.

## Thu tu lam chuan

```text
DB audit -> Backend read API -> Frontend MVP/Compact UI -> Supabase live read -> DB snapshot/write extension -> Security hardening -> AI planning/mindmap
```

## Trang thai hien tai

```text
Phase 0 - Done: repo/docs baseline.
Phase 1 - Done: backend VPS skeleton.
Phase 2 - Done: read API contracts.
Phase 3 - Done: frontend MVP modules.
Compact UI pass - Done enough for now: dashboard/cards/bottom nav compacted.
Phase 7 read API - Done: backend endpoints now read Supabase live data and keep frontend contracts.
Next major phase: add real MCP session snapshot/write model, starting with mcp_session_customers.
```

## Runtime hien tai

Backend:

```text
VPS: backend-DO-02
IP: 165.22.109.61
Runtime path: /var/www/mcp-plan-backend
Source path: /var/www/mcp-plan-source
PM2 app: mcp-plan-backend
Internal API: http://127.0.0.1:3001
Public API: http://165.22.109.61
```

Frontend:

```text
Vercel frontend points to NEXT_PUBLIC_API_BASE_URL=http://165.22.109.61
```

Supabase:

```text
Project ref: noiadkpkvdohljgopgfb
Backend health should show supabase: configured after VPS env is loaded.
```

## Current completed read endpoints

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

All data endpoints keep this wrapper:

```json
{
  "data": {},
  "receivedAt": "..."
}
```

## Current Supabase live read mapping

```text
mcp_routes -> routes, dashboard route health
mcp_route_customers -> route customers, MCP day planned customer lines
mcp_route_sessions -> current/latest MCP day run, route progress
mcp_visits -> MCP day results and visit KPIs
orders -> order list and dashboard sales
order_items -> SKU count and quantity
test_customer_results -> test/market-check cards
test_customers -> test account/area context
```

## Phase 0 - Dong bo repo va tai lieu

Trang thai: done.

Da co:

- `README.md`
- `docs/DB_AUDIT.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/API_PLAN.md`
- `docs/DB_EXTENSION_PLAN.md`
- `docs/VPS_BACKEND_HANDOFF.md`
- `docs/BACKEND_API_PHASE7.md`
- `docs/UI_REFERENCE_REPORT.md`
- `docs/UI_COMPACT_AUDIT.md`

## Phase 1 - Backend skeleton read-only

Trang thai: done.

Da co:

- `apps/backend/server.js`
- `apps/backend/package.json`
- `apps/backend/.env.example`
- VPS deploy script outside repo: `/var/www/deploy-mcp-backend.sh`
- PM2 app: `mcp-plan-backend`

Khong lam:

- Khong dung server secret trong browser.
- Khong them/sua schema khi chua co migration.
- Khong siết RLS khi write flow chua qua backend.

## Phase 2 - API dashboard cot loi

Trang thai: done.

Read endpoints da co va dang giu contract frontend.

KPI cot loi:

- So route active.
- So khach hang trong tuyen.
- So visit, ty le visit/planned.
- So visit/order/test/report.
- So result pending/ok/retry theo status.
- Doanh so theo order/order_items.

## Phase 3 - Frontend MVP

Trang thai: done enough for current phase.

Man hinh da co:

1. Dashboard tong quan.
2. Tuyen ban hang / route flow.
3. Khach hang theo tuyen.
4. MCP day/session.
5. Test san pham / field-check.
6. Don hang.
7. Bao cao thi truong.
8. MCP-Plan / actions.

UI da compact tam on:

- Dashboard co 4 module card: MCP / Don / Test / Bao cao.
- Bottom nav mobile con 5 muc: Tong / MCP / Don / Test / Plan.
- OperationalListCard da dung cho MCP/Routes/Orders/Test/Reports.

Con can sua UI sau:

- Card/list spacing van can polish theo thuc te mobile.
- Some labels/doc still have ASCII/unaccented text.
- Can tiep tuc lam gon tung man sau khi backend write on dinh.

## Phase 4 - DB extension rieng cho MCP-Plan

Trang thai: next major phase.

Viec can lam truoc write API:

```text
1. Audit orphans/relationships around mcp_routes, mcp_route_customers, mcp_route_sessions, mcp_visits.
2. Add mcp_session_customers snapshot table.
3. Backfill/derive snapshot from existing sessions carefully if needed.
4. Add FK/index/migration notes.
5. Only then add backend write APIs for open session / visit result / order / test / report / follow-up.
```

Bang can them truoc:

```text
mcp_session_customers
```

Rule quan trong:

```text
Route master thay doi sau khi mo phien khong duoc tu dong mutate session snapshot.
Khach them trong ngay source = added.
Khong hard delete khach khoi phien da mo.
Bo qua/huy can reason.
mcp_visits chi luu ket qua ghe that, khong phai planned list.
```

Bang du kien cho plan/action sau snapshot:

- `mcp_plans`
- `mcp_plan_items`
- `mcp_action_logs`
- `mcp_plan_snapshots`
- `mcp_user_settings`

## Phase 5 - Security hardening

Trang thai: chua lam, chi lam sau khi write flow da qua backend.

Van de hien co:

- Nhieu policy `anon insert/update` dang qua mo.
- Function `public.rls_auto_enable()` dang SECURITY DEFINER va public co the execute.
- Function `public.set_updated_at` can set search_path co dinh.

Huong sua dung logic:

- Frontend chi dung anon key cho read neu duoc phep.
- Write operation di qua backend hoac authenticated user co policy ro.
- Server secret chi nam tren backend.
- Rut execute public cho function nguy hiem.

Khong sua an toan bang cach tat RLS. RLS phai bat va policy phai dung.

## Phase 6 - AI planning/mindmap

Trang thai: de sau.

Chi lam sau khi dashboard, snapshot, write APIs va data contract on dinh.

AI module dung de:

- Goi y tuyen can uu tien.
- Goi y khach hang can ghe lai.
- Phat hien test result bat thuong.
- Tao next action tu order/test/visit.
- Xuat mindmap/plan theo ngay/tuan.

AI khong duoc doc DB truc tiep lung tung. Backend phai cap context da loc va da gom nhom.

## Viec lam ngay tiep theo

```text
1. Verify all Supabase live read endpoints after deploy.
2. Audit DB relationship/orphan data for MCP route/session/visit group.
3. Design SQL migration for mcp_session_customers.
4. Add backend write endpoint: open MCP daily session creates session customer snapshot.
5. Add backend write endpoint: update session customer status / visit result.
6. Move orders/tests/reports/follow-up creation from MCP customer card to backend-owned APIs.
7. Only then start RLS hardening.
```
