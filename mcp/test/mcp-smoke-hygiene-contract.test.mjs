import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const [
  filterSource,
  routesPage,
  mcpHome,
  dashboardOverview,
  sessionLoader,
  cleanupScript,
  routeApi,
  hardDeleteMigration,
  archiveDeleteJobTimingMigration
] = await Promise.all([
  readFile(new URL("../src/lib/data/internal-smoke.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/routes/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/mcp/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/features/dashboard/persisted-overview.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/mcp-sessions/load-mcp-sessions.ts", import.meta.url), "utf8"),
  readFile(new URL("../ops/cleanup-f05-smoke-fixtures.mjs", import.meta.url), "utf8"),
  readFile(new URL("../apps/backend/foundation/route-api.js", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20260723133000_harden_npp_f05_route_cleanup.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20260723144000_fix_archive_delete_job_fk_timing.sql", import.meta.url), "utf8")
]);

test("internal F05 smoke names are recognized only by the exact reserved prefix", () => {
  assert.match(filterSource, /__NPP_F05_RUNTIME_SMOKE__/);
  assert.match(filterSource, /startsWith\(prefix\)/);
  assert.doesNotMatch(filterSource, /includes\(prefix\)/);
});

test("route management and MCP home remove smoke routes before rendering totals or cards", () => {
  assert.match(routesPage, /withoutInternalSmokeRows\(routesResult\.data\.routes\)/);
  assert.match(routesPage, /routeIds\.has\(customer\.routeId\)/);
  assert.match(routesPage, /!isInternalSmokeRecord\(customer\)/);
  assert.match(mcpHome, /withoutInternalSmokeRows\(routesResult\.data\.routes\)/);
});

test("dashboard removes smoke facts before latest-session and report selection", () => {
  assert.match(dashboardOverview, /const visibleRoutes = routes\.filter/);
  assert.match(dashboardOverview, /const visibleSessions = sessions\.filter/);
  assert.match(dashboardOverview, /const visibleReports = reports\.filter/);
  assert.match(dashboardOverview, /routes\.splice\(0, routes\.length, \.\.\.visibleRoutes\)/);
  assert.match(dashboardOverview, /sessions\.splice\(0, sessions\.length, \.\.\.visibleSessions\)/);
  assert.match(dashboardOverview, /reports\.splice\(0, reports\.length, \.\.\.visibleReports\)/);
});

test("MCP session history excludes smoke routes, sessions and their counters", () => {
  assert.match(sessionLoader, /const visibleRoutes = withoutInternalSmokeRows\(routesRaw\)/);
  assert.match(sessionLoader, /!isInternalSmokeRecord\(session\)/);
  assert.match(sessionLoader, /visibleRouteIds\.has\(text\(session\.route_id\)\)/);
  assert.match(sessionLoader, /const sessions = scopedSessions/);
});

test("internal fixture inventory pages all routes and is restricted to authenticated service actors", () => {
  assert.match(routeApi, /F05_FIXTURE_PAGE_SIZE = 500/);
  assert.match(routeApi, /F05_FIXTURE_MAX_PAGES = 200/);
  assert.match(routeApi, /offset=\$\{offset\}/);
  assert.match(routeApi, /pageRows\.length < F05_FIXTURE_PAGE_SIZE/);
  assert.match(routeApi, /value\.startsWith\(F05_SMOKE_PREFIX\)/);
  assert.match(routeApi, /context\.actor\.type !== "service"/);
  assert.match(routeApi, /context\.actor\.authentication !== "backend-token"/);
  assert.match(routeApi, /\/api\/internal\/f05-smoke-fixtures/);
});

test("stale fixture cleanup archives exact reserved routes and verifies final inventory is empty", () => {
  assert.match(cleanupScript, /const SMOKE_PREFIX = "__NPP_F05_RUNTIME_SMOKE__"/);
  assert.match(cleanupScript, /\/api\/internal\/f05-smoke-fixtures/);
  assert.match(cleanupScript, /startsWith\(SMOKE_PREFIX\)/);
  assert.match(cleanupScript, /\/api\/routes\/\$\{encodeURIComponent\(routeId\)\}\/archive/);
  assert.match(cleanupScript, /X-Actor-Type": "service"/);
  assert.match(cleanupScript, /X-Actor-Authentication/);
  assert.match(cleanupScript, /waitUntilAbsent/);
  assert.match(cleanupScript, /fixture_route_remains_/);
  assert.match(cleanupScript, /fixture_routes_remain_/);
  assert.doesNotMatch(cleanupScript, /method:\s*"DELETE"/);
});

test("hard-delete recognizes only guarded NPP F05 routes and removes linked standalone orders", () => {
  assert.match(hardDeleteMigration, /v_is_npp_f05_smoke := coalesce\(r\.area, ''\) = 'API Smoke'/);
  assert.match(hardDeleteMigration, /left\(coalesce\(r\.route_name, ''\), length\('__NPP_F05_RUNTIME_SMOKE__'\)\) = '__NPP_F05_RUNTIME_SMOKE__'/);
  assert.match(hardDeleteMigration, /left\(coalesce\(r\.note, ''\), length\('__NPP_F05_RUNTIME_SMOKE__'\)\) = '__NPP_F05_RUNTIME_SMOKE__'/);
  assert.match(hardDeleteMigration, /raw_payload ->> 'route_customer_id' = any\(v_route_customer_ids\)/);
  assert.match(hardDeleteMigration, /raw_payload ->> 'routeCustomerId' = any\(v_route_customer_ids\)/);
  assert.match(hardDeleteMigration, /left\(coalesce\(note, ''\), length\('__NPP_F05_RUNTIME_SMOKE__'\)\) = '__NPP_F05_RUNTIME_SMOKE__'/);
  assert.doesNotMatch(hardDeleteMigration, /like\s+'%__NPP_F05_RUNTIME_SMOKE__%'/i);
});

test("archive intent FK is linked only after the delete-job row exists", () => {
  const beforeFunction = archiveDeleteJobTimingMigration.match(
    /create or replace function public\.mcp_link_archive_intent_from_delete_job\(\)([\s\S]*?)\$function\$;/
  )?.[1] || "";
  const afterFunction = archiveDeleteJobTimingMigration.match(
    /create or replace function public\.mcp_link_archive_intent_after_delete_job\(\)([\s\S]*?)\$function\$;/
  )?.[1] || "";

  assert.match(beforeFunction, /new\.raw_payload :=/);
  assert.doesNotMatch(beforeFunction, /update public\.mcp_archive_intents/);
  assert.match(afterFunction, /update public\.mcp_archive_intents/);
  assert.match(afterFunction, /set delete_job_id = new\.id/);
  assert.match(
    archiveDeleteJobTimingMigration,
    /create trigger mcp_storage_delete_jobs_prepare_archive_metadata\s+before insert or update of target_type, target_id, raw_payload/i
  );
  assert.match(
    archiveDeleteJobTimingMigration,
    /create trigger mcp_storage_delete_jobs_link_archive_intent\s+after insert or update/i
  );
});
