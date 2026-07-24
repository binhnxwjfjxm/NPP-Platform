import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);

async function read(relativePath) {
  return readFile(new URL(relativePath, root), "utf8");
}

test("Heroku runs the Core API from the repository root", async () => {
  assert.equal((await read("Procfile")).trim(), "web: npm run start:core-api");
  const pkg = JSON.parse(await read("package.json"));
  assert.deepEqual(pkg.workspaces, ["mcp", "mcp/apps/backend", "npp-core/api", "npp-core/web", "packages/*"]);
  assert.equal(pkg.scripts.start, "npm run start:core-api");
  assert.equal(pkg.scripts["heroku-postbuild"], "npm run build:core-api");
});
