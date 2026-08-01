import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const backendRoot = path.join(repoRoot, "mcp/apps/backend");

async function read(relativePath) {
  return readFile(path.join(repoRoot, relativePath), "utf8");
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(target));
    else files.push(target);
  }
  return files;
}

function assertActiveRuntimeBoundary(source) {
  const normalized = source.replace(/\r\n/g, "\n");
  assert.doesNotMatch(normalized, /\/rest\/v1/i);
  assert.doesNotMatch(normalized, /\/rpc(?:\/|["'`])/i);
  assert.doesNotMatch(normalized, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(normalized, /service[-_ ]role/i);
}

test("active production import graph does not load legacy Supabase runtime", async () => {
  const bootstrap = await read("mcp/apps/backend/bootstrap.js");
  const gateway = await read("mcp/apps/backend/foundation/gateway.js");
  const persistence = await read("mcp/apps/backend/foundation/persistence.js");
  const postgresql = await read("mcp/apps/backend/foundation/postgresql-adapter.js");

  assertActiveRuntimeBoundary(bootstrap);
  assertActiveRuntimeBoundary(gateway);
  assertActiveRuntimeBoundary(postgresql);
  assert.doesNotMatch(bootstrap, /server\.js/);
  assert.doesNotMatch(gateway, /from\s+["']\.\/(?:order-api|route-api|transitional-api)\.js["']/);
  assert.doesNotMatch(persistence, /import\s+\{[^}]*createLegacySupabasePersistence/);
  assert.match(persistence, /await import\("\.\/supabase-adapter\.js"\)/);
  assert.match(bootstrap, /if \(config\.legacyRuntime\.enabled\)/);
  assert.match(bootstrap, /await import\("\.\/foundation\/legacy-runtime\.js"\)/);
});

test("business handler sources contain no direct Supabase REST, RPC or service-role handling", async () => {
  const files = (await walk(path.join(backendRoot, "foundation"))).filter((file) => {
    const name = path.basename(file);
    return /(?:-api|-mutations)\.js$/.test(name) && !name.endsWith(".test.js");
  });
  assert.ok(files.length > 10);
  for (const file of files) {
    const source = await readFile(file, "utf8");
    assertActiveRuntimeBoundary(source);
  }
});

test("legacy provider implementation is isolated and explicitly classified", async () => {
  const legacyRuntime = await read("mcp/apps/backend/foundation/legacy-runtime.js");
  const compatibilityAdapter = await read("mcp/apps/backend/foundation/supabase-adapter.js");
  const legacyAdapter = await read("mcp/apps/backend/foundation/legacy-supabase-adapter.js");
  const legacyServer = await read("mcp/apps/backend/server.js");

  assert.match(legacyRuntime, /SUPABASE_URL/);
  assert.match(legacyRuntime, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(compatibilityAdapter, /export async function supabaseRequest/);
  assert.match(compatibilityAdapter, /\/rest\/v1/);
  assert.match(legacyAdapter, /from "\.\/supabase-adapter\.js"/);
  assert.doesNotMatch(legacyAdapter, /\/rest\/v1/);
  assert.match(legacyServer, /\/rest\/v1/);
});

test("runtime boundary audit behaves identically for Linux LF and Windows CRLF", async () => {
  const source = [
    await read("mcp/apps/backend/bootstrap.js"),
    await read("mcp/apps/backend/foundation/gateway.js"),
    await read("mcp/apps/backend/foundation/postgresql-adapter.js")
  ].join("\n");
  assertActiveRuntimeBoundary(source.replace(/\r?\n/g, "\n"));
  assertActiveRuntimeBoundary(source.replace(/\r?\n/g, "\r\n"));
});

test("Docker and CI smoke contracts do not inject Supabase credentials", async () => {
  const dockerfile = await read("mcp/apps/backend/Dockerfile");
  const ciWorkflow = await read(".github/workflows/heroku-mcp-backend-contract-ci.yml");
  const manualWorkflow = await read(".github/workflows/heroku-mcp-backend-manual.yml");
  const requiredLine = manualWorkflow.match(/HEROKU_REQUIRED_CONFIG_NAMES:.*$/m)?.[0] || "";

  assert.doesNotMatch(dockerfile, /SUPABASE_/);
  assert.doesNotMatch(ciWorkflow, /SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(requiredLine, /SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(requiredLine, /DATABASE_URL/);
  assert.match(ciWorkflow, /smoke \/health\/live 200/);
  assert.match(ciWorkflow, /smoke \/health\/ready 503/);
});
