import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { supabaseRequest } from "./supabase-adapter.js";

const here = dirname(fileURLToPath(import.meta.url));

function source(path) {
  return readFileSync(join(here, path), "utf8");
}

function rpcNames(value) {
  return new Set([...value.matchAll(/\b(mcp_[a-z0-9_]+)\b/g)].map((match) => match[1]));
}

function usedRpcNames() {
  const ignored = new Set([
    "postgresql-compat-adapter.js",
    "postgresql-media-adapter.js",
    "postgresql-media-upload-adapter.js",
    "postgresql-archive-adapter.js",
    "postgresql-checkin-adapter.js",
    "postgresql-report-adapter.js",
    "supabase-adapter.js",
    "legacy-supabase-adapter.js"
  ]);
  const names = new Set();
  for (const entry of readdirSync(here, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".js") || entry.name.endsWith(".test.js") || ignored.has(entry.name)) continue;
    const value = source(entry.name);
    for (const match of value.matchAll(/supabaseRpc\s*\(\s*config\s*,\s*"(mcp_[a-z0-9_]+)"/g)) {
      names.add(match[1]);
    }
  }
  return names;
}

test("every active Supabase RPC contract has a PostgreSQL implementation", () => {
  const supported = new Set([
    ...rpcNames(source("postgresql-compat-adapter.js")),
    ...rpcNames(source("postgresql-media-adapter.js")),
    ...rpcNames(source("postgresql-media-upload-adapter.js")),
    ...rpcNames(source("postgresql-archive-adapter.js")),
    ...rpcNames(source("postgresql-checkin-adapter.js")),
    ...rpcNames(source("postgresql-report-adapter.js"))
  ]);
  const missing = [...usedRpcNames()].filter((name) => !supported.has(name)).sort();
  assert.deepEqual(missing, []);
});

test("canonical and runtime cutover migrations remain byte-identical", () => {
  for (const name of [
    "003_mcp_legacy_write_contract.sql",
    "004_mcp_profile_media_contract.sql"
  ]) {
    const canonical = readFileSync(join(here, `../../../../database/migrations/mcp/${name}`), "utf8");
    const runtime = source(`migrations/sql/${name}`);
    assert.equal(runtime, canonical, name);
  }
});

test("PostgreSQL mode refuses direct legacy provider HTTP", async () => {
  let fetchCalls = 0;
  const legacyPath = ["", "rest", "v1", "mcp_routes"].join("/");
  await assert.rejects(
    supabaseRequest(
      { persistence: { provider: "postgresql" }, legacyRuntime: { enabled: false } },
      legacyPath,
      { fetchImpl: async () => { fetchCalls += 1; throw new Error("must_not_fetch"); } }
    ),
    (error) => error.code === "legacy_provider_request_forbidden" && error.statusCode === 503
  );
  assert.equal(fetchCalls, 0);
});

test("cutover modules are part of backend source verification", () => {
  const pkg = JSON.parse(readFileSync(join(here, "../package.json"), "utf8"));
  for (const file of [
    "foundation/postgresql-compat-adapter.js",
    "foundation/postgresql-media-adapter.js",
    "foundation/postgresql-media-upload-adapter.js",
    "foundation/postgresql-archive-adapter.js",
    "foundation/postgresql-checkin-adapter.js",
    "foundation/postgresql-report-adapter.js",
    "foundation/provider-runtime.js",
    "foundation/typed-runtime.js"
  ]) {
    assert.match(pkg.scripts.build, new RegExp(file.replaceAll(".", "\\.")));
  }
  assert.match(pkg.scripts.test, /postgresql-provider-coverage\.test\.js/);
  assert.match(pkg.scripts.test, /postgresql-cutover-flow-integration\.test\.js/);
  assert.equal(basename(here), "foundation");
});
