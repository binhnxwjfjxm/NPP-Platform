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
