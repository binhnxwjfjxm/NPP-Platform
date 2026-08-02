import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("customer tab projects the canonical route customer endpoint", () => {
  const page = read("src/features/accounts/AccountsPage.tsx");
  const projection = read("src/features/accounts/accounts-from-route-customers.ts");

  assert.match(page, /getRouteCustomersData\(\)/);
  assert.doesNotMatch(page, /getAccountsData\(\)/);
  assert.match(projection, /accountsFromRouteCustomers/);
  assert.match(projection, /tier: "-"/);
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
