import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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

test("automatic Vercel deployments stay locked by default", () => {
  assert.equal(coreConfig.git?.deploymentEnabled, false);
  assert.match(workflow, /^\s{2}workflow_dispatch:\s*$/m);
  assert.match(workflow, /^\s{2}issue_comment:\s*$/m);
  assert.doesNotMatch(workflow, /^\s{2}(?:push|pull_request):\s*$/m);
});

test("comment deployment requires the exact guarded command", () => {
  assert.match(workflow, /github\.event\.issue\.number == 5/);
  assert.match(workflow, /github\.event\.comment\.body == '\/deploy-vercel-production'/);
  assert.match(workflow, /\["binhnxwjfjxm","khuongbinhinfo-a11y"\]/);
  assert.match(workflow, /github\.actor/);
});

test("manual deployment uses Vercel CLI without mutating Git deployment gates", () => {
  assert.match(workflow, /permissions:\s*\n\s+contents: read/);
  assert.match(workflow, /VERCEL_ORG_ID: \$\{\{ secrets\.VERCEL_ORG_ID \}\}/);
  assert.match(workflow, /VERCEL_PROJECT_ID: \$\{\{ secrets\.VERCEL_PROJECT_ID \}\}/);
  assert.match(workflow, /vercel@latest pull/);
  assert.match(workflow, /vercel@latest build/);
  assert.match(workflow, /vercel@latest deploy/);
  assert.match(workflow, /--prebuilt/);
  assert.match(workflow, /--prod/);
  assert.match(workflow, /secrets\.VERCEL_TOKEN/);
  assert.match(workflow, /git\.rev-parse|git rev-parse/);
  assert.match(workflow, /deploymentEnabled !== false/);

  assert.doesNotMatch(workflow, /deploymentEnabled: true/);
  assert.doesNotMatch(workflow, /git push origin HEAD:main/);
  assert.doesNotMatch(workflow, /Open one-shot production gate/);
  assert.doesNotMatch(workflow, /Re-lock automatic deployments/);
  assert.doesNotMatch(workflow, /vcp_[A-Za-z0-9_-]+/);
});

test("production deployment performs required smoke checks", () => {
  assert.match(workflow, /for path in \/ \/dashboard \/login/);
  assert.match(workflow, /\/_next\/static\//);
  assert.match(workflow, /DEPLOYED_SHA=/);
  assert.match(workflow, /DEPLOYED_URL=/);
});
