import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

test("Lô 5 registers MCP workforce permissions and keeps field preset away from configuration permissions", () => {
  const migration = source("../../database/migrations/shared/086_mcp_workforce_permission_catalog.sql");
  const presets = source("../../npp-core/web/app/access/roles/role-presets.ts");
  for (const permission of [
    "mcp.session.write", "mcp.session-customer.write", "mcp.order.write", "mcp.test.write",
    "mcp.report.write", "mcp.followup.write", "mcp.sales-order.read", "mcp.sales-order.create",
    "mcp.route.write", "mcp.route-customer.write", "mcp.report-setting.write"
  ]) assert.match(migration, new RegExp(permission.replaceAll(".", "\\.")));

  const fieldBlock = presets.match(/case 'mcp-field':[\s\S]*?case 'logistics-manager':/)?.[0] || "";
  for (const permission of [
    "mcp.session.write", "mcp.session-customer.write", "mcp.order.write", "mcp.test.write",
    "mcp.report.write", "mcp.followup.write", "mcp.sales-order.read", "mcp.sales-order.create"
  ]) assert.match(fieldBlock, new RegExp(permission.replaceAll(".", "\\.")));
  for (const permission of ["mcp.route.write", "mcp.route-customer.write", "mcp.report-setting.write"]) {
    assert.doesNotMatch(fieldBlock, new RegExp(permission.replaceAll(".", "\\.")));
  }
});

test("Lô 5 uses trusted v4 workforce permissions and protects configuration UI plus direct API", () => {
  const auth = source("../src/lib/mcp-auth.ts");
  const middleware = source("../src/middleware.ts");
  const appShell = source("../src/ui/shell/AppShell.tsx");
  const mobileMenu = source("../src/ui/shell/MobileAppMenu.tsx");
  const requestContext = source("../apps/backend/foundation/request-context.js");
  const writeCommand = source("../apps/backend/foundation/write-command.js");
  const readApi = source("../apps/backend/foundation/read-api.js");

  assert.match(auth, /"v4"/);
  assert.match(auth, /canonicalList\(user\.permissions/);
  assert.match(auth, /canonicalList\(user\.scopes/);
  assert.match(requestContext, /version === "v4"/);
  assert.match(requestContext, /owner \? \[\.\.\.\(configured\.permissions/);
  assert.match(writeCommand, /currentFoundationRequestContext\(\) \|\| context/);
  assert.match(readApi, /mcp\.report-setting\.write/);

  for (const token of ["/routes/:path*", "/mcp-setting/:path*", "/api/backend/:path*", "mcp.route.write", "mcp.route-customer.write", "mcp.report-setting.write"]) {
    assert.ok(middleware.includes(token), `missing middleware contract: ${token}`);
  }
  assert.match(appShell, /requiredNavigationPermission/);
  assert.match(appShell, /mcp\.report-setting\.write/);
  assert.match(mobileMenu, /requiredNavigationPermission/);
  assert.match(mobileMenu, /mcp\.route\.write/);
});
