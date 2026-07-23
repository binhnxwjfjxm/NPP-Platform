#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const SMOKE_PREFIX = "__NPP_F05_RUNTIME_SMOKE__";

function parseEnv(source) {
  const values = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.replace(/^export\s+/, "").match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

function required(env, name) {
  const value = String(env[name] || "").trim();
  if (!value) throw new Error(`missing_${name.toLowerCase()}`);
  return value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function actorHeaders(env, requestId) {
  return {
    Accept: "application/json",
    "X-Backend-Token": env.BACKEND_API_TOKEN,
    "X-Request-Id": requestId,
    "X-Actor-Id": env.NPP_F05_EXPECTED_ACTOR_ID || "service:mcp-plan:f05-fixture-cleanup",
    "X-Actor-Type": "service",
    "X-Actor-Authentication": env.NPP_F05_EXPECTED_ACTOR_AUTHENTICATION || "backend-token"
  };
}

async function listFixtures(env, requestId) {
  const response = await fetch(`${env.MCP_API_BASE_URL}/api/internal/f05-smoke-fixtures`, {
    cache: "no-store",
    headers: actorHeaders(env, requestId)
  });
  if (!response.ok) throw new Error(`list_f05_fixtures_${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload?.data)) throw new Error("f05_fixture_list_response_invalid");
  return payload.data.filter((row) => String(row?.name || row?.note || "").trim().startsWith(SMOKE_PREFIX));
}

async function routeStillExists(env, routeId, attempt) {
  const fixtures = await listFixtures(env, `f05-stale-check-${routeId}-${attempt}`);
  return fixtures.some((route) => String(route?.id || "").trim() === routeId);
}

async function archiveRoute(env, routeId, attempt) {
  const requestId = `f05-stale-cleanup-${routeId}-${attempt}`;
  const response = await fetch(`${env.MCP_API_BASE_URL}/api/routes/${encodeURIComponent(routeId)}/archive`, {
    method: "POST",
    cache: "no-store",
    headers: {
      ...actorHeaders(env, requestId),
      "Content-Type": "application/json",
      "Idempotency-Key": `f05-fixture-cleanup.${routeId}.${attempt}`
    },
    body: "{}"
  });
  if (!response.ok && response.status !== 404) throw new Error(`archive_route_${routeId}_${response.status}`);
}

async function waitUntilAbsent(env, routeId) {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    if (!(await routeStillExists(env, routeId, attempt))) return true;
    if (attempt % 6 === 0) await archiveRoute(env, routeId, attempt);
    await sleep(500);
  }
  return false;
}

async function main() {
  const envPath = process.argv[2] || "/var/www/mcp-plan-backend/.env";
  const env = { ...parseEnv(await readFile(envPath, "utf8")), ...process.env };
  env.MCP_API_BASE_URL = String(env.MCP_API_BASE_URL || env.BACKEND_API_BASE_URL || "http://127.0.0.1:3001").replace(/\/+$/, "");
  env.BACKEND_API_TOKEN = required(env, "BACKEND_API_TOKEN");

  const fixtures = await listFixtures(env, "f05-stale-fixture-inventory");

  for (const fixture of fixtures) {
    const routeId = String(fixture.id || "").trim();
    if (!routeId) continue;
    await archiveRoute(env, routeId, 1);
    if (!(await waitUntilAbsent(env, routeId))) throw new Error(`fixture_route_remains_${routeId}`);
    console.log(`fixture_route_removed:${routeId}`);
  }

  const remaining = await listFixtures(env, "f05-stale-fixture-final-check");
  if (remaining.length) throw new Error(`fixture_routes_remain_${remaining.length}`);
  console.log(`F05_SMOKE_FIXTURE_CLEANUP=PASS routes=${fixtures.length}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "f05_smoke_fixture_cleanup_failed");
  process.exitCode = 1;
});
