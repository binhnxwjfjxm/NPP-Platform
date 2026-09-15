import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { handleLocalReadApi } from "../apps/backend/foundation/local-read-api.js";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("customer tab renders route outlets locally and refreshes scoped company customers in the background", () => {
  const page = read("src/features/accounts/AccountsPage.tsx");
  const localPage = read("src/features/accounts/AccountsLocalPage.tsx");
  const client = read("src/features/accounts/OutletsClientPage.tsx");
  const loader = read("src/lib/api/customer-onboarding-data.ts");
  const service = read("apps/backend/foundation/customer-verification.js");
  const access = read("apps/backend/foundation/customer-route-access.js");
  const settings = read("src/features/settings/SettingsPage.tsx");
  const logout = read("src/features/settings/McpLogoutButton.tsx");

  assert.match(page, /AccountsLocalPage/);
  assert.doesNotMatch(page, /loadOwnedRouteCustomersData|loadOwnedCoreCustomers/);
  assert.match(localPage, /useMcpShellSnapshot\(\)/);
  assert.match(localPage, /useMcpLocalResource<CoreCustomerItem\[]>\("customers"\)/);
  assert.match(localPage, /accountsFromRouteCustomers/);
  assert.match(client, />Điểm bán/);
  assert.match(client, />Khách công ty/);
  assert.match(client, /\/customers\/onboarding\/\$\{encodeURIComponent\(item\.routeCustomerId\)\}/);
  assert.match(loader, /\/api\/customer-verifications/);
  assert.match(loader, /\/api\/core-customers/);
  assert.match(service, /listAccessibleCoreCustomers/);
  assert.doesNotMatch(service, /FROM mcp\.accounts/);
  assert.doesNotMatch(service, /sales_owner = \$2/);
  assert.match(access, /route\.sales/);
  assert.match(access, /mcp\.installation-owner/);
  assert.doesNotMatch(access, /rc\.responsible_employee_id\s*=/);
  assert.match(settings, /McpLogoutButton/);
  assert.match(logout, /clearMcpLocalReadForCurrentUser/);
  assert.match(logout, /\/api\/auth\/logout/);
});

test("orders tab renders the last local snapshot while canonical Công Ty orders refresh in the background", () => {
  const routePage = read("src/app/orders/page.tsx");
  const page = read("src/features/orders/OrdersPage.tsx");
  const localPage = read("src/features/orders/OrdersLocalPage.tsx");
  const data = read("src/features/orders/orders-local-data.ts");
  const client = read("src/features/orders/OrdersClientPage.tsx");
  const loader = read("src/features/orders/CoreOrderCreateLoader.tsx");
  const sheet = read("src/features/orders/CoreOrderCreateSheet.tsx");
  const ordersLoader = read("src/lib/api/orders-data.ts");
  const trustedLoader = read("src/lib/api/customer-onboarding-data.ts");
  const directService = read("apps/backend/foundation/direct-sales-orders.js");

  assert.match(routePage, /OrdersPage/);
  assert.doesNotMatch(routePage, /McpCoreOrdersPage/);
  assert.match(page, /OrdersLocalPage/);
  assert.doesNotMatch(page, /loadOrdersResult|loadOwnedCoreSalesOrders|loadCustomerOnboardingQueue/);
  assert.match(localPage, /useMcpLocalResource<ApiResult<OrderDto\[]>\>\("orders"\)/);
  assert.match(localPage, /useMcpShellSnapshot\(\)/);
  assert.match(data, /loadOrdersResult\(\)/);
  assert.match(data, /loadOwnedCoreSalesOrders\(\)/);
  assert.match(data, /loadCustomerOnboardingQueue\(\)/);
  assert.match(data, /currentVersion\(order\)/);
  assert.match(data, /coreCodes/);
  assert.match(client, /label: "Đơn hàng"/);
  assert.match(client, /label: "Cần xử lý"/);
  assert.match(client, /label: "Doanh số đặt hàng"/);
  assert.match(client, /label: "Tổng quan"/);
  assert.match(loader, /useMcpLocalResource<OrderCustomerItem\[]>\("customers"\)/);
  assert.match(loader, /dispatchMcpLocalResourceRefresh\("orders"\)/);
  assert.doesNotMatch(loader, /fetch\("\/api\/backend\/core-customers"/);
  assert.doesNotMatch(loader, /customer-verifications|approved|linked_existing/);
  assert.match(sheet, /\/api\/backend\/core-sales\/orders/);
  assert.match(sheet, /createIdempotencyKey\("mcp\.sales-order\.create"\)/);
  assert.doesNotMatch(sheet, /\/api\/backend\/orders/);
  assert.match(trustedLoader, /loadOwnedCoreSalesOrders/);
  assert.match(trustedLoader, /\/api\/core-sales\/orders/);
  assert.match(directService, /readCoreSalesOrder/);
  assert.match(directService, /ORDER_DETAIL_CONCURRENCY/);
  assert.match(ordersLoader, /backendReadRows<Row>\("orders"/);
  assert.match(ordersLoader, /backendReadRows<Row>\("order_items"/);
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

test("MCP recent sessions open local-first and keep the extended-range live fallback", () => {
  const page = read("src/app/mcp/sessions/page.tsx");
  const localPage = read("src/features/mcp/McpSessionsLocalPage.tsx");
  const manager = read("src/features/mcp/McpSessionsManagerSafe.tsx");
  const route = read("src/app/api/mcp-sessions/route.ts");
  const loader = read("src/lib/mcp-sessions/load-mcp-sessions.ts");
  assert.match(page, /McpSessionsLocalPage/);
  assert.doesNotMatch(page, /loadMcpSessions\(filters\)/);
  assert.match(localPage, /useMcpShellSnapshot\(\)/);
  assert.match(localPage, /needsExtendedRange/);
  assert.match(localPage, /fetch\(`\/api\/mcp-sessions\?/);
  assert.match(manager, /dispatchMcpLocalReadRefresh/);
  assert.doesNotMatch(manager, /router\.refresh\(\)/);
  assert.match(route, /loadMcpSessions/);
  assert.match(loader, /import "server-only";/);
  assert.match(loader, /restRows<SessionTableRow>/);
});

test("MCP overview, routes and points use a session-bound local identity without an auth fetch before IndexedDB", () => {
  const rootPage = read("src/app/page.tsx");
  const layout = read("src/app/layout.tsx");
  const overview = read("src/app/mcp/page.tsx");
  const routes = read("src/app/routes/page.tsx");
  const master = read("src/features/mcp/McpMasterView.tsx");
  const photos = read("src/features/mcp/OutletPhotoManager.tsx");
  const hook = read("src/lib/local-read/use-mcp-shell.ts");
  const identity = read("src/lib/local-read/mcp-local-identity.ts");
  const identityServer = read("src/lib/local-read/mcp-local-identity-server.ts");
  const apiRoute = read("src/app/api/local-read/mcp-shell/route.ts");
  const serverLoader = read("src/lib/local-read/mcp-shell-server.ts");
  const gateway = read("apps/backend/foundation/gateway.js");
  const backend = read("apps/backend/foundation/local-read-api.js");
  const sharedCache = read("../packages/shared-utils/browser-local-read-cache.js");
  assert.match(rootPage, /McpDashboardLocalPage/);
  assert.match(layout, /McpLocalIdentityProvider/);
  assert.match(layout, /mcpLocalCacheUserIdFromSession/);
  assert.match(overview, /McpHomeLocalPage/);
  assert.match(routes, /McpRoutesLocalPage/);
  assert.doesNotMatch(overview, /loadRoutesData\(\)/);
  assert.doesNotMatch(routes, /loadRoutesData\(\)|loadRouteCustomersData\(\)/);
  assert.match(master, /dispatchMcpLocalReadRefresh/);
  assert.doesNotMatch(master, /router\.refresh\(\)/);
  assert.match(photos, /dispatchMcpLocalReadRefresh/);
  assert.doesNotMatch(photos, /router\.refresh\(\)/);
  assert.match(hook, /memorySnapshot/);
  assert.match(hook, /useMcpLocalUserId\(\)/);
  assert.match(hook, /readLocalFirst/);
  assert.doesNotMatch(hook, /fetch\("\/api\/auth\/me"/);
  assert.match(identity, /createContext/);
  assert.doesNotMatch(identity, /sessionStorage|\/api\/auth\/me/);
  assert.match(identityServer, /readMcpSessionToken/);
  assert.match(identityServer, /createHash\("sha256"\)/);
  assert.match(apiRoute, /loadMcpShellDelta/);
  assert.match(serverLoader, /\/api\/local-read\/mcp-shell/);
  assert.match(gateway, /handleLocalReadApi/);
  assert.match(backend, /DISTINCT ON \(route_id\)/);
  assert.match(backend, /CURRENT_DATE - \$2::integer/);
  assert.match(backend, /GROUP BY session_id/);
  assert.match(sharedCache, /assertLocalReadCacheSafe/);
});

test("MCP customer, order and report page resources use the shared IndexedDB contract", () => {
  const hook = read("src/lib/local-read/use-mcp-local-resource.ts");
  const route = read("src/app/api/local-read/mcp-page-data/route.ts");
  const reportsPage = read("src/app/reports/page.tsx");
  assert.match(hook, /createLocalReadCache/);
  assert.match(hook, /readLocalFirst/);
  assert.match(hook, /useMcpLocalUserId\(\)/);
  assert.match(hook, /dispatchMcpLocalResourceRefresh/);
  assert.match(route, /loadOwnedCoreCustomers/);
  assert.match(route, /loadOrdersLocalData/);
  assert.match(route, /loadMarketReportsLocalData/);
  assert.match(route, /createHash\("sha256"\)/);
  assert.doesNotMatch(route, /message:\s*error instanceof Error/);
  assert.match(reportsPage, /MarketReportsLocalPage/);
  assert.doesNotMatch(reportsPage, /MarketReportsPage searchParams/);
});

test("MCP product search does not preload the full catalog or resolve price N+1 for list results", () => {
  const route = read("src/app/api/products/search/route.ts");
  const backend = read("apps/backend/foundation/core-sales-api.js");
  assert.doesNotMatch(route, /catalog", "all"/);
  assert.match(route, /if \(!search\)/);
  assert.match(route, /limit", "30"/);
  assert.match(route, /includePrice", "false"/);
  assert.match(backend, /url\.searchParams\.get\("includePrice"\) === "false"/);
  assert.match(backend, /filtered\.map\(\(item\) => mapSkuOption\(item, null\)\)/);
});

test("MCP local-read backend stops after cursor check when nothing changed", async () => {
  const queries = [];
  const persistence = {
    async assertReady() {},
    async withTransaction(work) {
      return work({ async query(sql, values) { queries.push({ sql: String(sql), values }); return { rows: [{ cursor: "cursor-same" }] }; } });
    }
  };
  const result = await handleLocalReadApi({ method: "GET", headers: {} }, new URL("http://mcp.local/api/local-read/mcp-shell?cursor=cursor-same"), { installation: { id: "installation-a" } }, {}, { persistence });
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.data.unchanged, true);
  assert.equal(result.payload.data.snapshot, null);
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].values, ["installation-a"]);
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
