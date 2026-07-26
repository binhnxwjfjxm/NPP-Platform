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

test("special command opens and re-locks the nested Core web gate", () => {
  assert.match(workflow, /permissions:\s*\n\s+contents: write/);
  assert.match(workflow, /const path = "npp-core\/web\/vercel\.json"/);
  assert.match(workflow, /git add npp-core\/web\/vercel\.json/);
  assert.match(workflow, /git show origin\/main:npp-core\/web\/vercel\.json/);
  assert.match(workflow, /deploymentEnabled: true/);
  assert.match(workflow, /deploymentEnabled: false/);
  assert.match(workflow, /open one-shot production gate \[skip ci\]/);
  assert.match(workflow, /re-lock automatic deployments \[skip ci\]/);
  assert.match(workflow, /Allow Vercel to accept the production event/);
  assert.match(workflow, /if: always\(\)/);
  assert.doesNotMatch(workflow, /VERCEL_TOKEN|vcp_[A-Za-z0-9_-]+/);
});
