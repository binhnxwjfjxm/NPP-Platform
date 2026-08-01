import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mcpConfig = JSON.parse(
  await readFile(new URL("../vercel.json", import.meta.url), "utf8")
);
const mcpWorkflow = await readFile(
  new URL("../../.github/workflows/vercel-mcp-production-manual.yml", import.meta.url),
  "utf8"
);
const coreWorkflow = await readFile(
  new URL("../../.github/workflows/vercel-production-manual.yml", import.meta.url),
  "utf8"
);
const foundationWorkflow = await readFile(
  new URL("../../.github/workflows/foundation-f0-2.yml", import.meta.url),
  "utf8"
);

const CORE_PROJECT_ID = "prj_vFEAzoxesLqNJIfD8uF4q1kytpvk";
const MCP_PROJECT_ID = "prj_854SWdJeDEOPezAvvTZzTaRvZUSq";
const MCP_PRODUCTION_URL = "https://mcp-field-binhnxwjfjxms-projects.vercel.app";

test("MCP Vercel automatic deployments stay disabled", () => {
  assert.equal(mcpConfig.git?.deploymentEnabled, false);
  assert.match(mcpWorkflow, /^\s{2}workflow_dispatch:\s*$/m);
  assert.match(mcpWorkflow, /^\s{2}issue_comment:\s*$/m);
  assert.doesNotMatch(mcpWorkflow, /^\s{2}(?:push|pull_request):\s*$/m);
});

test("MCP deploy has an exact Issue #5 command separate from Core", () => {
  assert.match(mcpWorkflow, /github\.event\.issue\.number == 5/);
  assert.match(mcpWorkflow, /\/deploy-vercel-mcp-production/);
  assert.doesNotMatch(mcpWorkflow, /'\/deploy-vercel-production'/);

  assert.match(coreWorkflow, /\/deploy-vercel-production/);
  assert.doesNotMatch(coreWorkflow, /\/deploy-vercel-mcp-production/);
});

test("MCP deploy target is pinned and isolated from the Core Vercel project", () => {
  assert.match(mcpWorkflow, new RegExp(`VERCEL_PROJECT_ID:\\s*${MCP_PROJECT_ID}`));
  assert.match(mcpWorkflow, new RegExp(`LEGACY_VERCEL_PROJECT_ID:\\s*${CORE_PROJECT_ID}`));
  assert.match(mcpWorkflow, new RegExp(`MCP_PRODUCTION_URL:\\s*${MCP_PRODUCTION_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.doesNotMatch(mcpWorkflow, /vars\.VERCEL_MCP_PROJECT_ID/);
  assert.doesNotMatch(mcpWorkflow, /vars\.VERCEL_MCP_PRODUCTION_URL/);
  assert.doesNotMatch(
    mcpWorkflow,
    new RegExp(`VERCEL_PROJECT_ID:\\s*${CORE_PROJECT_ID}`)
  );
  assert.match(mcpWorkflow, /mcp_project_must_not_equal_core_project/);
  assert.match(mcpWorkflow, /unexpected_mcp_vercel_project/);
  assert.match(mcpWorkflow, /unexpected_mcp_root_directory/);
});

test("MCP deploy checks out main, installs in mcp and runs Vercel CLI from monorepo root", () => {
  assert.match(mcpWorkflow, /DEPLOY_REF: main/);
  assert.match(mcpWorkflow, /MCP_ROOT_DIRECTORY: mcp/);
  assert.match(mcpWorkflow, /git fetch origin main --depth=1/);
  assert.match(mcpWorkflow, /git rev-parse origin\/main/);
  assert.match(mcpWorkflow, /cache-dependency-path: mcp\/package-lock\.json/);
  assert.match(
    mcpWorkflow,
    /- name: Install MCP dependencies\s+working-directory: mcp\s+run: npm ci/
  );
  assert.match(
    mcpWorkflow,
    /- name: Pull MCP production project configuration\s+run:/
  );
  assert.match(
    mcpWorkflow,
    /- name: Verify MCP Vercel project link\s+shell: bash/
  );
  assert.match(
    mcpWorkflow,
    /- name: Build MCP production artifact\s+run:/
  );
  assert.match(
    mcpWorkflow,
    /- name: Deploy MCP production artifact\s+id: deploy\s+shell: bash/
  );
  assert.doesNotMatch(
    mcpWorkflow,
    /- name: (?:Pull MCP production project configuration|Verify MCP Vercel project link|Build MCP production artifact|Deploy MCP production artifact)\s+working-directory: mcp/
  );

  assert.doesNotMatch(mcpWorkflow, /working-directory: npp-core\/web/);
  assert.doesNotMatch(mcpWorkflow, /hung-phat-945da1547594/);
  assert.doesNotMatch(mcpWorkflow, /heroku container:push|heroku container:release|git push heroku/);
});

test("MCP deploy synchronizes only its required runtime configuration without printing values", () => {
  assert.match(mcpWorkflow, /^\s{2}issues: write$/m);
  assert.match(mcpWorkflow, /MCP_BACKEND_APP_NAME: hung-phat-mcp/);
  assert.match(mcpWorkflow, /heroku apps:info -a "\$MCP_BACKEND_APP_NAME" --json/);
  assert.match(mcpWorkflow, /heroku config -a "\$MCP_BACKEND_APP_NAME" --json/);
  assert.match(mcpWorkflow, /\.BACKEND_API_TOKEN \/\/ empty/);
  assert.match(mcpWorkflow, /\.MCP_LEGACY_ACTOR_ID \/\/ empty/);
  assert.match(mcpWorkflow, /vercel@latest env pull/);
  assert.match(mcpWorkflow, /api\.vercel\.com\/v10\/projects\/\$\{process\.env\.VERCEL_PROJECT_ID\}\/env/);
  assert.match(mcpWorkflow, /upsert=true/);
  assert.match(mcpWorkflow, /type: "encrypted"/);
  assert.match(mcpWorkflow, /target: \["production"\]/);
  assert.match(mcpWorkflow, /::add-mask::/);
  assert.match(mcpWorkflow, /process\.env\.GITHUB_ENV/);
  assert.match(mcpWorkflow, /BACKEND_API_BASE_URL/);
  assert.match(mcpWorkflow, /BACKEND_API_TOKEN/);
  assert.match(mcpWorkflow, /MCP_LEGACY_ACTOR_ID/);
  assert.match(mcpWorkflow, /SUPABASE_URL/);
  assert.match(mcpWorkflow, /SUPABASE_ANON_KEY/);
  assert.match(mcpWorkflow, /MCP Vercel production preflight failed/);
  assert.match(mcpWorkflow, /MCP Vercel production deploy succeeded/);

  assert.doesNotMatch(mcpWorkflow, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(mcpWorkflow, /DATABASE_URL/);
  assert.doesNotMatch(mcpWorkflow, /postgres(?:ql)?:\/\//i);
});

test("MCP deploy builds, deploys and smokes its own Vercel artifact", () => {
  assert.match(mcpWorkflow, /vercel@latest pull/);
  assert.match(mcpWorkflow, /vercel@latest build/);
  assert.match(mcpWorkflow, /vercel@latest deploy/);
  assert.match(mcpWorkflow, /--prebuilt/);
  assert.match(mcpWorkflow, /--prod/);
  assert.match(mcpWorkflow, /secrets\.VERCEL_TOKEN/);
  assert.match(
    mcpWorkflow,
    /- name: Smoke exact MCP production deployment[\s\S]*DEPLOYMENT_URL: \$\{\{ steps\.deploy\.outputs\.url \}\}/
  );
  assert.match(
    mcpWorkflow,
    /- name: Smoke configured MCP production alias[\s\S]*DEPLOYMENT_URL: \$\{\{ env\.MCP_PRODUCTION_URL \}\}/
  );
  assert.match(mcpWorkflow, /assert_status \/ /);
  assert.match(mcpWorkflow, /assert_status \/visits/);
  assert.match(mcpWorkflow, /\/_next\/static\//);
  assert.match(mcpWorkflow, /MCP_DEPLOYED_SHA=/);
  assert.match(mcpWorkflow, /MCP_DEPLOYED_URL=/);
});

test("Foundation CI gates workflow path deltas and runs the Vercel contract", () => {
  assert.match(foundationWorkflow, /Verify workflow workspace path delta/);
  assert.match(foundationWorkflow, /BASELINE_REPO_ROOT/);
  assert.match(foundationWorkflow, /workflow_path_delta_failed/);
  assert.match(foundationWorkflow, /npm ci --prefix apps\/backend/);
  assert.match(foundationWorkflow, /npm run test:vercel-deployment-control/);
  assert.doesNotMatch(
    foundationWorkflow,
    /npm run test:workflow-paths 2>&1 \| tee workflow-path-audit\.log/
  );
});
