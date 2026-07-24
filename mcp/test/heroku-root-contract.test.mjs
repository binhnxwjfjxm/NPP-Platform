import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);

async function read(relativePath) {
  return readFile(new URL(relativePath, root), "utf8");
}

test("Heroku starts the nested backend from the repository root", async () => {
  assert.equal((await read("Procfile")).trim(), "web: npm start");
  const pkg = JSON.parse(await read("package.json"));
  assert.deepEqual(pkg.workspaces, ["mcp/apps/backend"]);
  assert.equal(pkg.scripts.start, "npm --workspace mcp-plan-backend run start");
  assert.equal(pkg.scripts["heroku-postbuild"], "npm run build");
});
