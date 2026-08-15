import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("customer tab reads canonical Core customers through the trusted employee-scoped boundary", () => {
  const page = read("src/features/accounts/AccountsPage.tsx");
  const loader = read("src/lib/api/customer-onboarding-data.ts");
  const service = read("apps/backend/foundation/customer-verification.js");

  assert.match(page, /loadOwnedCoreCustomers\(\)/);
  assert.match(page, /\/customers\/onboarding/);
  assert.doesNotMatch(page, /loadRouteCustomersData\(\)/);
  assert.doesNotMatch(page, /accountsFromRouteCustomers/);

  assert.match(loader, /\/api\/core-customers/);
  assert.match(service, /FROM mcp\.accounts/);
  assert.match(service, /sales_owner = \$2/);
  assert.match(service, /active = true/);
  assert.match(service, /requireEmployee\(context\)/);
  assert.doesNotMatch(page, /tier|lastVisitDate|lastOrderDate|monthlyRevenue/);
});

test("orders tab reads orders and customers through the backend provider", () => {
  const page = read("src/features/orders/OrdersPage.tsx");
  const loader = read("src/lib/api/orders-data.ts");

  assert.match(page, /loadOrdersResult\(\)/);
  assert.match(page, /getRouteCustomersData: loadRouteCustomersData/);
  assert.match(page, /api\.getRouteCustomersData\(\)/);
  assert.doesNotMatch(page, /createApiClient/);
  assert.match(loader, /backendReadRows<Row>\("orders"/);
  assert.match(loader, /backendReadRows<Row>\("order_items"/);
  assert.doesNotMatch(loader, /\/api\/orders/);
});

test("action plan reads followups through the backend provider", () => {
  const page = read("src/features/actions/ActionsPage.tsx");
  const loader = read("src/lib/api/actions-data.ts");

  assert.match(page, /loadActionsData\(\)/);
  assert.doesNotMatch(page, /createApiClient/);
  assert.doesNotMatch(page, /getActionsData\(\)/);
  assert.match(loader, /backendReadRows<Row>\("mcp_followups"/);
  assert.match(loader, /backendReadRows<Row>\("mcp_session_customers"/);
  assert.match(loader, /backendReadRows<Row>\("mcp_routes"/);
  assert.doesNotMatch(loader, /\/api\/actions\/data/);
});

test("MCP sessions page never self-fetches its Vercel deployment", () => {
  const page = read("src/app/mcp/sessions/page.tsx");
  const route = read("src/app/api/mcp-sessions/route.ts");
  const loader = read("src/lib/mcp-sessions/load-mcp-sessions.ts");

  assert.match(page, /loadMcpSessions\(filters\)/);
  assert.doesNotMatch(page, /\bfetch\s*\(/);
  assert.doesNotMatch(page, /headers\(\)/);
  assert.doesNotMatch(page, /getRequestBaseUrl/);
  assert.match(route, /loadMcpSessions/);
  assert.match(loader, /import "server-only";/);
  assert.match(loader, /restRows<SessionTableRow>/);
});

test("MCP overview and routes use the PostgreSQL backend read boundary", () => {
  const overview = read("src/app/mcp/page.tsx");
  const routes = read("src/app/routes/page.tsx");
  const loader = read("src/lib/api/routes-data.ts");

  assert.match(overview, /loadRoutesData\(\)/);
  assert.doesNotMatch(overview, /createApiClient/);
  assert.match(routes, /loadRoutesData\(\)/);
  assert.match(routes, /loadRouteCustomersData\(\)/);
  assert.doesNotMatch(routes, /createApiClient/);
  assert.match(loader, /backendReadRows<RouteRow>\("mcp_routes"/);
  assert.match(loader, /backendReadRows<RouteCustomerRow>\("mcp_route_customers"/);
  assert.match(loader, /backendReadRows<RouteSessionRow>\("mcp_route_sessions"/);
  assert.doesNotMatch(loader, /\/api\/routes\/data/);
  assert.doesNotMatch(loader, /\/api\/routes\/customers\/data/);
});

test("legacy report settings GET reads PostgreSQL while writes keep the guarded backend mutation route", () => {
  const aliasRoute = read("src/app/api/mcp-report-settings/route.ts");
  const backendRoute = read("src/app/api/backend/mcp-report-settings/route.ts");

  assert.match(aliasRoute, /@\/app\/api\/backend\/mcp-report-settings\/route/);
  assert.match(backendRoute, /backendReadRows<Row>\("mcp_report_setting_groups"/);
  assert.match(backendRoute, /backendReadRows<Row>\("mcp_report_settings"/);
  assert.match(backendRoute, /includeInactive/);
  assert.doesNotMatch(backendRoute, /proxyBackendRequest\(request, "\/api\/mcp-report-settings", "GET"\)/);
  assert.match(backendRoute, /proxyBackendRequest\(request, "\/api\/mcp-report-settings", "POST"\)/);
  assert.match(backendRoute, /proxyBackendRequest\(request, "\/api\/mcp-report-settings", "PATCH"\)/);
  assert.doesNotMatch(backendRoute, /SUPABASE|supabase/);
});
