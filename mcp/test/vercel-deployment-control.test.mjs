import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import "./vercel-mcp-deployment-control.test.mjs";

const coreConfig = JSON.parse(
  await readFile(new URL("../../npp-core/web/vercel.json", import.meta.url), "utf8")
);
const rootConfig = JSON.parse(
  await readFile(new URL("../../vercel.json", import.meta.url), "utf8")
);
const workflow = await readFile(
  new URL("../../.github/workflows/vercel-production-manual.yml", import.meta.url),
  "utf8"
);

const NPP_PLATFORM_PROJECT_ID = "prj_vFEAzoxesLqNJIfD8uF4q1kytpvk";

test("Vercel uses the NPP Core web package as its project root", () => {
  assert.equal(coreConfig.builds, undefined);
  assert.equal(coreConfig.routes, undefined);
  assert.equal(coreConfig.framework, undefined);
  assert.equal(coreConfig.outputDirectory, undefined);
});

test("legacy repository-root config is inert and locked", () => {
  assert.equal(rootConfig.git?.deploymentEnabled, false);
  assert.equal(rootConfig.builds, undefined);
  assert.equal(rootConfig.routes, undefined);
  assert.equal(rootConfig.build, undefined);
});

test("automatic Core Vercel deployments stay locked by default", () => {
  assert.equal(coreConfig.git?.deploymentEnabled, false);
  assert.match(workflow, /^\s{2}workflow_dispatch:\s*$/m);
  assert.match(workflow, /^\s{2}issue_comment:\s*$/m);
  assert.doesNotMatch(workflow, /^\s{2}(?:push|pull_request):\s*$/m);
});

test("Core comment deployment requires its exact Issue #5 command", () => {
  assert.match(workflow, /github\.event\.issue\.number == 5/);
  assert.match(workflow, /trimmed_comment/);
  assert.match(workflow, /'\/deploy-vercel-production'/);
  assert.doesNotMatch(workflow, /\/deploy-vercel-mcp-production/);
  assert.match(workflow, /\["binhnxwjfjxm","khuongbinhinfo-a11y"\]/);
  assert.match(workflow, /github\.actor/);
});

test("Core deployment is pinned to the npp-platform project", () => {
  assert.match(workflow, /VERCEL_ORG_ID: team_hBA8rX68UHC8ogvREkOyQlJ2/);
  assert.match(
    workflow,
    new RegExp(`VERCEL_PROJECT_ID: ${NPP_PLATFORM_PROJECT_ID}`)
  );
  assert.match(workflow, /Verify Vercel project link/);
  assert.match(workflow, /linked\.projectId !== process\.env\.VERCEL_PROJECT_ID/);
  assert.match(workflow, /linked\.settings\?\.rootDirectory !== 'npp-core\/web'/);
  assert.doesNotMatch(workflow, /vars\.VERCEL_MCP_PROJECT_ID/);
});

test("Core deployment installs dependencies and deploys only the Core Vercel target", () => {
  assert.match(workflow, /permissions:\s*\n\s+contents: read/);
  assert.match(workflow, /Install workspace dependencies/);
  assert.match(workflow, /run: npm ci/);
  assert.match(workflow, /vercel@latest pull/);
  assert.match(workflow, /vercel@latest deploy/);
  assert.match(workflow, /--prod/);
  assert.match(workflow, /secrets\.VERCEL_TOKEN/);
  assert.match(workflow, /git fetch origin main --depth=1/);
  assert.match(workflow, /git rev-parse origin\/main/);

  assert.doesNotMatch(workflow, /working-directory: mcp/);
  assert.doesNotMatch(workflow, /heroku container:push|heroku container:release|git push heroku/);
  assert.doesNotMatch(workflow, /deploymentEnabled: true/);
  assert.doesNotMatch(workflow, /git push origin HEAD:main/);
  assert.doesNotMatch(workflow, /vcp_[A-Za-z0-9_-]+/);
});

test("Core production deployment performs its required smoke checks", () => {
  assert.match(workflow, /assert_status \/ 302 307/);
  assert.match(workflow, /assert_status \/login 200/);
  assert.match(workflow, /assert_status \/dashboard 401/);
  assert.match(workflow, /\/_next\/static\//);
  assert.match(workflow, /DEPLOYED_SHA=/);
  assert.match(workflow, /DEPLOYED_URL=/);
});
