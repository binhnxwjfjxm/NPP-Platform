import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationPath = path.join(
  root,
  "supabase/migrations/20260715154000_harden_mcp_smoke_route_cleanup.sql"
);

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function walk(directory) {
  if (!(await exists(directory))) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(target)));
    else files.push(target);
  }
  return files;
}

const productionRoots = [
  path.join(root, "src"),
  path.join(root, "apps/backend"),
  path.join(root, "supabase/functions")
];
const optionalSeed = path.join(root, "supabase/seed.sql");
const sourceExtensions = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".sql", ".json"]);
const forbiddenRuntimeMarkers = [
  /__MCP_V1_API_/,
  /API Smoke/,
  /Final Smoke/,
  /2099-12-27/,
  /2099-12-30/,
  /2099-12-31/
];

test("production runtime and seed contain no smoke fixtures", async () => {
  const files = [];
  for (const directory of productionRoots) files.push(...(await walk(directory)));
  if (await exists(optionalSeed)) files.push(optionalSeed);

  const violations = [];
  for (const file of files) {
    if (!sourceExtensions.has(path.extname(file))) continue;
    const source = await readFile(file, "utf8");
    for (const marker of forbiddenRuntimeMarkers) {
      if (marker.test(source)) {
        violations.push(`${path.relative(root, file)}:${marker}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

test("MCP v1 API smoke always runs guarded cleanup after the smoke body", async () => {
  const source = await readFile(path.join(root, "scripts/smoke-mcp-v1-api.mjs"), "utf8");
  assert.match(source, /async function cleanupAllRoutes\(\)/);
  assert.match(source, /await cleanupAllRoutes\(\)/);
  assert.match(source, /let primaryError = null/);
  assert.match(source, /let cleanupError = null/);
  assert.match(source, /data\.smokeCleanup === true/);
  assert.doesNotMatch(source, /await cleanupRoute\(routeId\);\s*\n\s*return \{/);
});

test("smoke route cleanup migration is strict and service-role-only", async () => {
  const source = await readFile(migrationPath, "utf8");
  assert.match(source, /route_name[^\n]*\^__MCP_V1_API_\(FULL\|SNAPSHOT_ONCE\)__/);
  assert.match(source, /coalesce\(r\.area, ''\) = 'API Smoke'/);
  assert.match(source, /coalesce\(r\.note, ''\) = 'temporary MCP v1 API smoke'/);
  assert.match(source, /delete from public\.order_items where order_id = any\(v_order_ids\)/);
  assert.match(source, /delete from public\.orders where id = any\(v_order_ids\)/);
  assert.match(source, /delete from public\.test_customer_results where file_id = any\(v_test_file_ids\)/);
  assert.match(source, /delete from public\.market_reports/);
  assert.match(source, /delete from public\.mcp_session_reports where route_id = p_route_id/);
  assert.match(source, /revoke all on function public\.mcp_delete_route_hard\(text\) from public, anon, authenticated/);
  assert.match(source, /grant execute on function public\.mcp_delete_route_hard\(text\) to service_role/);
});

test("PWA metadata includes both standard and Apple capable declarations", async () => {
  const source = await readFile(path.join(root, "src/app/layout.tsx"), "utf8");
  assert.match(source, /appleWebApp:\s*\{/);
  assert.match(source, /"mobile-web-app-capable":\s*"yes"/);
});
