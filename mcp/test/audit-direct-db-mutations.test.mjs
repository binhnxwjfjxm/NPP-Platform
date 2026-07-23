import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { scanRepository } from "../scripts/audit-direct-db-mutations.mjs";

async function makeRepo(files = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mcp-direct-db-audit-"));
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }
  await mkdir(path.join(root, "scripts"), { recursive: true });
  await writeBaseline(root, []);
  return root;
}

async function writeBaseline(root, entries) {
  await writeFile(
    path.join(root, "scripts/direct-db-mutation-baseline.json"),
    `${JSON.stringify({ schemaVersion: 1, entries }, null, 2)}\n`,
    "utf8"
  );
}

function baselineEntry(finding, classification, overrides = {}) {
  return {
    fingerprint: finding.fingerprint,
    classification,
    operation: finding.operation,
    owner: "foundation-boundary",
    reason: classification === "approved-boundary"
      ? "Audited provider boundary."
      : "Known legacy provider coupling.",
    replacementPhase: classification === "approved-boundary" ? "keep" : "A5.2",
    replacementTarget: classification === "approved-boundary" ? "provider adapter" : "application use case",
    ...overrides
  };
}

async function withRepo(files, callback) {
  const root = await makeRepo(files);
  try {
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function scan(root, scanRoots) {
  return scanRepository({ root, scanRoots, writeReports: false });
}

test("browser direct insert fails", async () => {
  await withRepo({
    "src/app/page.tsx": `"use client";\nconst save = () => supabase.from("orders").insert({ id: 1 });\n`
  }, async (root) => {
    const result = await scan(root, ["src"]);
    assert.equal(result.findings[0].classification, "forbidden");
    assert.ok(result.errors.some((error) => error.startsWith("browser_direct_mutation:")));
  });
});

test("approved adapter mutation passes", async () => {
  await withRepo({
    "apps/backend/foundation/provider.js": `export async function writeProvider(config, body) {\n  return fetch(new URL("/rest/v1/orders", config.url), { method: "POST", body: JSON.stringify(body) });\n}\n`
  }, async (root) => {
    const first = await scan(root, ["apps/backend"]);
    await writeBaseline(root, [baselineEntry(first.findings[0], "approved-boundary")]);
    const second = await scan(root, ["apps/backend"]);
    assert.deepEqual(second.errors, []);
  });
});

test("known legacy debt passes but stays visible", async () => {
  await withRepo({
    "apps/backend/foundation/transitional.js": `export async function saveLegacy(config, body) {\n  return supabaseRest(config, "market_reports", { method: "POST", body });\n}\n`
  }, async (root) => {
    const first = await scan(root, ["apps/backend"]);
    await writeBaseline(root, [baselineEntry(first.findings[0], "known-legacy-debt")]);
    const second = await scan(root, ["apps/backend"]);
    assert.deepEqual(second.errors, []);
    assert.equal(second.summary.legacyDebt, 1);
  });
});

test("next-server service-role mutation must be explicit legacy debt", async () => {
  await withRepo({
    "src/lib/legacy-write.ts": `const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;\nexport async function saveLegacy(url, body) {\n  return fetch(new URL("/rest/v1/mcp_session_reports", url), { method: "POST", headers: { Authorization: \`Bearer \${SUPABASE_SERVICE_ROLE_KEY}\` }, body: JSON.stringify(body) });\n}\n`
  }, async (root) => {
    const first = await scan(root, ["src"]);
    assert.ok(first.errors.some((error) => error.startsWith("service_role_wrong_consumer:")));
    await writeBaseline(root, [baselineEntry(first.findings[0], "known-legacy-debt", {
      owner: "session-report",
      replacementPhase: "A5.4"
    })]);
    const second = await scan(root, ["src"]);
    assert.deepEqual(second.errors, []);
    assert.equal(second.findings[0].operation, "mutation");
    assert.equal(second.summary.legacyDebt, 1);
  });
});

test("new finding outside baseline fails", async () => {
  await withRepo({
    "apps/backend/new-write.js": `export async function save(body) { return supabasePatch("orders", body); }\n`
  }, async (root) => {
    const result = await scan(root, ["apps/backend"]);
    assert.ok(result.errors.some((error) => error.startsWith("unclassified_finding:")));
  });
});

test("stale baseline fails", async () => {
  await withRepo({}, async (root) => {
    await writeBaseline(root, [{
      fingerprint: "deadbeefdeadbeefdeadbeef",
      classification: "known-legacy-debt",
      operation: "mutation",
      owner: "legacy-backend",
      reason: "Fixture stale entry.",
      replacementPhase: "A5.2",
      replacementTarget: "application use case"
    }]);
    const result = await scan(root, ["src"]);
    assert.ok(result.errors.includes("stale_baseline:deadbeefdeadbeefdeadbeef"));
  });
});

test("REST GET is read, not mutation", async () => {
  await withRepo({
    "src/lib/report-source.ts": `export async function loadReport(config) {\n  return fetch(new URL("/rest/v1/mcp_session_reports", config.url), { method: "GET" });\n}\n`
  }, async (root) => {
    const result = await scan(root, ["src"]);
    assert.equal(result.findings[0].operation, "read");
  });
});

test("Edge service-role mutation is detected", async () => {
  await withRepo({
    "supabase/functions/mcp-day/index.ts": `const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");\nexport async function saveVisit(url, body) {\n  return fetch(new URL("/rest/v1/mcp_visits", url), { method: "POST", body: JSON.stringify(body) });\n}\n`
  }, async (root) => {
    const first = await scan(root, ["supabase"]);
    assert.equal(first.findings[0].consumer, "edge");
    assert.equal(first.findings[0].usesServiceRole, true);
    assert.ok(first.errors.some((error) => error.startsWith("public_edge_mutation_not_legacy_debt:")));
    await writeBaseline(root, [baselineEntry(first.findings[0], "known-legacy-debt", { replacementPhase: "A5.3" })]);
    const second = await scan(root, ["supabase"]);
    assert.deepEqual(second.errors, []);
  });
});

test("node_modules and generated directories are skipped", async () => {
  await withRepo({
    "src/clean.ts": `export const clean = true;\n`,
    "src/node_modules/bad.js": `supabase.from("orders").insert({});\n`,
    "src/.next/bad.js": `supabase.from("orders").insert({});\n`,
    "src/dist/bad.js": `supabase.from("orders").insert({});\n`,
    "src/build/bad.js": `supabase.from("orders").insert({});\n`,
    "src/coverage/bad.js": `supabase.from("orders").insert({});\n`
  }, async (root) => {
    const result = await scan(root, ["src"]);
    assert.equal(result.findings.length, 0);
  });
});
