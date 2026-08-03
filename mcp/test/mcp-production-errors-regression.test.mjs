import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { handleReadApi } from "../apps/backend/foundation/read-api.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

function jsonRequest(body) {
  const req = Readable.from([JSON.stringify(body)]);
  req.method = "POST";
  return req;
}

test("PostgreSQL MCP reads are forced into the current installation", async () => {
  let captured = null;
  const persistence = {
    async assertReady() {},
    async withTransaction(callback) {
      return callback({
        async query(sql, params) {
          captured = { sql, params };
          return { rows: [] };
        }
      });
    }
  };

  const response = await handleReadApi(
    jsonRequest({
      table: "mcp_report_setting_groups",
      filters: { installation_id: "eq.attacker-installation", active: true }
    }),
    new URL("http://mcp.local/api/read"),
    { installation: { id: "current-installation" } },
    {},
    { persistence }
  );

  assert.equal(response.statusCode, 200);
  assert.match(captured.sql, /"installation_id" = \$1/);
  assert.equal(captured.params[0], "current-installation");
  assert.doesNotMatch(JSON.stringify(captured.params), /attacker-installation/);
});

test("report settings read and write now share the guarded installation boundary", () => {
  const readApi = read("apps/backend/foundation/read-api.js");
  const route = read("src/app/api/backend/mcp-report-settings/route.ts");

  assert.match(readApi, /INSTALLATION_SCOPED_READ_TABLES/);
  assert.match(readApi, /"mcp_report_setting_groups"/);
  assert.match(readApi, /"mcp_report_settings"/);
  assert.match(readApi, /next\.installation_id = `eq\.\$\{currentInstallationId\}`/);
  assert.match(route, /backendReadRows<Row>\("mcp_report_setting_groups"/);
  assert.match(route, /proxyBackendRequest\(request, "\/api\/mcp-report-settings", "POST"\)/);
  assert.match(route, /proxyBackendRequest\(request, "\/api\/mcp-report-settings", "PATCH"\)/);
});

test("visits page reads the current MCP day from PostgreSQL instead of the old API client", () => {
  const page = read("src/app/visits/page.tsx");
  const route = read("src/app/api/mcp-day/data/route.ts");
  const loader = read("src/lib/api/mcp-day-data.ts");

  assert.match(page, /loadMcpDayData\(\{ routeId, date \}\)/);
  assert.match(page, /loadRoutesData\(\)/);
  assert.match(page, /loadRouteCustomersData\(\)/);
  assert.doesNotMatch(page, /createApiClient|getMcpDayData\(dayQuery\)/);

  assert.match(route, /loadMcpDayData/);
  assert.match(route, /ROUTE_ID_REQUIRED/);
  assert.match(route, /MCP_DAY_READ_FAILED/);
  assert.doesNotMatch(route, /error\.message/);
  assert.match(loader, /backendReadRows<Row>\("mcp_route_sessions"/);
  assert.match(loader, /backendReadRows<Row>\("mcp_session_customers"/);
  assert.match(loader, /backendReadRows<Row>\("mcp_visits"/);
  assert.match(loader, /filters: \{ session_id: sessionId \}/);
  assert.doesNotMatch(loader, /SUPABASE|supabase|createApiClient/);
});
