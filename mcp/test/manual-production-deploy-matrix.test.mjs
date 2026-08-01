import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = {
  vercelNpp: ".github/workflows/vercel-production-manual.yml",
  vercelMcp: ".github/workflows/vercel-mcp-production-manual.yml",
  herokuNpp: ".github/workflows/heroku-npp-backend-manual.yml",
  herokuMcp: ".github/workflows/heroku-mcp-backend-manual.yml",
};

async function source(path) {
  return readFile(path, "utf8");
}

test("manual production deploy workflows expose four explicit Actions names", async () => {
  const entries = await Promise.all(Object.values(files).map(source));
  const expected = [
    "name: Manual Vercel NPP production deploy",
    "name: Manual Vercel MCP production deploy",
    "name: Manual Heroku NPP production deploy",
    "name: Manual Heroku MCP production deploy",
  ];

  assert.deepEqual(entries.map((text) => text.split(/\r?\n/, 1)[0]), expected);
  for (const text of entries) {
    assert.match(text, /workflow_dispatch:/);
    assert.match(text, /cancel-in-progress: false/);
  }
});

test("Vercel workflows are locked to distinct NPP and MCP projects", async () => {
  const npp = await source(files.vercelNpp);
  const mcp = await source(files.vercelMcp);

  assert.match(npp, /VERCEL_PROJECT_ID: prj_vFEAzoxesLqNJIfD8uF4q1kytpvk/);
  assert.match(npp, /rootDirectory !== 'npp-core\/web'/);
  assert.doesNotMatch(npp, /VERCEL_MCP_PROJECT_ID/);

  assert.match(mcp, /VERCEL_PROJECT_ID: prj_854SWdJeDEOPezAvvTZzTaRvZUSq/);
  assert.match(mcp, /MCP_PRODUCTION_URL: https:\/\/mcp-field-binhnxwjfjxms-projects\.vercel\.app/);
  assert.doesNotMatch(mcp, /vars\.VERCEL_MCP_PROJECT_ID/);
  assert.doesNotMatch(mcp, /vars\.VERCEL_MCP_PRODUCTION_URL/);
  assert.match(mcp, /MCP_ROOT_DIRECTORY: mcp/);
  assert.match(mcp, /mcp_project_must_not_equal_legacy_runtime_source/);
  assert.doesNotMatch(mcp, /rootDirectory !== 'npp-core\/web'/);
});

test("Heroku workflows fail closed across the Core and MCP app boundary", async () => {
  const npp = await source(files.herokuNpp);
  const mcp = await source(files.herokuMcp);

  assert.match(npp, /HEROKU_APP_NAME: hung-phat\n/);
  assert.match(npp, /HEROKU_FORBIDDEN_APP_NAME: hung-phat-mcp/);
  assert.match(npp, /web: npm run start:core-api/);
  assert.doesNotMatch(npp, /container:push web/);

  assert.match(mcp, /HEROKU_APP_NAME: hung-phat-mcp/);
  assert.match(mcp, /HEROKU_FORBIDDEN_APP_NAME: hung-phat\n/);
  assert.match(mcp, /cd mcp\/apps\/backend/);
  assert.match(mcp, /container:push web/);

  for (const text of [npp, mcp]) {
    assert.match(text, /smoke_health \/health\/live/);
    assert.match(text, /smoke_health \/health\/ready/);
    assert.match(text, /releases:rollback/);
  }
});

test("manual deploy workflows never embed database credentials", async () => {
  const entries = await Promise.all(Object.values(files).map(source));
  for (const text of entries) {
    assert.doesNotMatch(text, /postgres(?:ql)?:\/\/[^\s"']+@/i);
    assert.doesNotMatch(text, /SUPABASE_SERVICE_ROLE_KEY:\s*[^$\s]/);
  }
});
