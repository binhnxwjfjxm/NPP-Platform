import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = {
  vercelNpp: ".github/workflows/vercel-production-manual.yml",
  vercelMcp: ".github/workflows/vercel-mcp-production-manual.yml",
  vpsCompany: ".github/workflows/vps-company-backend-manual.yml",
  vpsMcp: ".github/workflows/vps-mcp-backend-manual.yml",
  herokuNpp: ".github/workflows/heroku-npp-backend-manual.yml",
  herokuMcp: ".github/workflows/heroku-mcp-backend-manual.yml",
  herokuMcpScript: "mcp/apps/backend/scripts/manual-production-deploy.sh",
};

async function source(path) {
  return readFile(path, "utf8");
}

test("active production deploy workflows expose Vercel frontend and VPS backend Actions names", async () => {
  const workflowPaths = [files.vercelNpp, files.vercelMcp, files.vpsCompany, files.vpsMcp];
  const entries = await Promise.all(workflowPaths.map(source));
  const expected = [
    "name: Manual Vercel NPP production deploy",
    "name: Manual Vercel MCP production deploy",
    "name: VPS Công Ty backend manual deploy",
    "name: VPS MCP backend manual deploy",
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
  assert.match(mcp, /CORE_VERCEL_PROJECT_ID: prj_vFEAzoxesLqNJIfD8uF4q1kytpvk/);
  assert.match(mcp, /MCP_PRODUCTION_URL: https:\/\/mcp\.nguyenlieuhungphat\.com/);
  assert.doesNotMatch(mcp, /vars\.VERCEL_MCP_PROJECT_ID/);
  assert.doesNotMatch(mcp, /vars\.VERCEL_MCP_PRODUCTION_URL/);
  assert.match(mcp, /MCP_ROOT_DIRECTORY: mcp/);
  assert.match(mcp, /mcp_project_must_not_equal_core_project/);
  assert.doesNotMatch(mcp, /rootDirectory !== 'npp-core\/web'/);
});

test("retired Heroku workflows remain fail-closed historical contracts", async () => {
  const npp = await source(files.herokuNpp);
  const mcpWorkflow = await source(files.herokuMcp);
  const mcpScript = await source(files.herokuMcpScript);
  const mcp = `${mcpWorkflow}\n${mcpScript}`;

  assert.match(npp, /name: RETIRED — Heroku Công Ty production deploy/);
  assert.match(mcpWorkflow, /name: RETIRED — Heroku MCP production deploy/);
  assert.match(npp, /false &&/);
  assert.match(mcpWorkflow, /false &&/);
  assert.match(npp, /Canonical production command: \/deploy-vps-company-production/);
  assert.match(mcpWorkflow, /Canonical production command: \/deploy-vps-mcp-production/);

  assert.match(npp, /HEROKU_APP_NAME: hung-phat\n/);
  assert.match(npp, /HEROKU_FORBIDDEN_APP_NAME: hung-phat-mcp/);
  assert.match(npp, /web: npm run start:core-api/);
  assert.doesNotMatch(npp, /container:push web/);

  assert.match(mcpWorkflow, /HEROKU_APP_NAME: hung-phat-mcp/);
  assert.match(mcpWorkflow, /HEROKU_FORBIDDEN_APP_NAME: hung-phat\n/);
  assert.match(mcpScript, /cd mcp\/apps\/backend/);
  assert.match(mcpScript, /container:push web/);

  for (const text of [npp, mcp]) {
    assert.match(text, /smoke_health \/health\/live/);
    assert.match(text, /smoke_health \/health\/ready/);
    assert.match(text, /releases:rollback/);
  }
});

test("MCP Heroku health smoke never creates a double-slash path", async () => {
  const mcp = await source(files.herokuMcpScript);

  assert.match(mcp, /app_url="\$\{app_url%\/\}"/);
  assert.match(mcp, /"\$\{app_url%\/\}\$path"/);
  assert.match(mcp, /sed 's:\/\*\$::'/);
  assert.doesNotMatch(mcp, /"\$app_url\$path"/);
});

test("manual deploy workflows and scripts never embed database credentials", async () => {
  const entries = await Promise.all(Object.values(files).map(source));
  for (const text of entries) {
    assert.doesNotMatch(text, /postgres(?:ql)?:\/\/[^\s"']+@/i);
    assert.doesNotMatch(text, /SUPABASE_SERVICE_ROLE_KEY:\s*[^$\s]/);
  }
});
