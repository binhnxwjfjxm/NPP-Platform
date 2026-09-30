import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../../database/migrations/mcp/017_mcp_session_employee_ownership.sql", import.meta.url), "utf8");
const lifecycle = await readFile(new URL("../apps/backend/foundation/session-lifecycle-mutations.js", import.meta.url), "utf8");
const sessionAdapter = await readFile(new URL("../apps/backend/foundation/postgresql-session-adapter.js", import.meta.url), "utf8");
const compatAdapter = await readFile(new URL("../apps/backend/foundation/postgresql-compat-adapter.js", import.meta.url), "utf8");
const readApi = await readFile(new URL("../apps/backend/foundation/read-api.js", import.meta.url), "utf8");
const localRead = await readFile(new URL("../apps/backend/foundation/local-read-api.js", import.meta.url), "utf8");
const compatibilityRead = await readFile(new URL("../apps/backend/foundation/postgresql-compatibility-api.js", import.meta.url), "utf8");
const visits = await readFile(new URL("../src/features/mcp/VisitsLocalPage.tsx", import.meta.url), "utf8");
const master = await readFile(new URL("../src/features/mcp/McpMasterView.tsx", import.meta.url), "utf8");

test("route master stays shared while active session uniqueness is employee scoped", () => {
  assert.match(migration, /owner_employee_id uuid NULL/);
  assert.match(migration, /installation_id, route_id, owner_employee_id/);
  assert.match(migration, /mcp_route_sessions_one_active_employee_idx/);
  assert.match(migration, /REFERENCES shared\.employees \(installation_id, id\)/);
});

test("authenticated employee identity reaches session persistence and session-derived mutations", () => {
  assert.match(lifecycle, /employeeId: context\.principal\?\.employeeId/);
  assert.match(sessionAdapter, /owner_employee_id/);
  assert.match(sessionAdapter, /session_not_owned/);
  assert.match(compatAdapter, /session_not_owned/);
  assert.doesNotMatch(sessionAdapter, /finalizeStaleSession|auto_closed_for_session_date/);
});

test("reads are scoped to the logged-in employee while route masters remain company shared", () => {
  assert.match(readApi, /EMPLOYEE_SCOPED_READ_TABLES/);
  assert.match(readApi, /owner_employee_id/);
  assert.match(readApi, /owner_customer\.order_id/);
  assert.match(localRead, /status = 'active' OR session_date >= CURRENT_DATE/);
  assert.match(localRead, /owner_employee_id/);
  assert.match(compatibilityRead, /owner_employee_id/);
});

test("PWA resumes an active session across date boundaries instead of silently opening a new one", () => {
  assert.match(visits, /sessions\.filter\(\(session\) => session\.status === "active"\)/);
  assert.doesNotMatch(visits, /session\.sessionDate === date && session\.status === "active"/);
  assert.match(master, /Tiếp tục phiên/);
  assert.match(master, /session-status\?routeId=/);
  assert.match(master, /activeSession\.sessionDate/);
  assert.match(master, /operation: "route-session\.open"/);
});
