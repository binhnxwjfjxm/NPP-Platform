import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/lib/api/api-client.ts", import.meta.url), "utf8");

test("backend API client is server-only", () => {
  assert.match(source, /^import "server-only";/m);
});

test("all backend requests carry the private gateway token", () => {
  assert.match(source, /process\.env\.BACKEND_API_TOKEN/);
  assert.match(source, /"X-Backend-Token": backendApiToken/);
  assert.match(source, /fetchJson<[^>]+>\([^\n]*backendApiToken/);
  assert.match(source, /postJson<[^>]+>\([^\n]*backendApiToken/);
});

test("production fails closed when backend token is absent", () => {
  assert.match(source, /missing_backend_api_token/);
  assert.match(source, /!backendApiToken\s*&&\s*isProductionRuntime\(\)/);
});
