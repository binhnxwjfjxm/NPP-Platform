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
  assert.match(workflow, /permissions:\s*\n\s+contents: read/);
  assert.doesNotMatch(workflow, /contents: write/);
});

test("production command requires an explicit exact SHA", () => {
  assert.match(workflow, /github\.event\.issue\.number == 5/);
  assert.match(workflow, /startsWith\(github\.event\.comment\.body, '\/deploy-vercel-production '\)/);
  assert.match(workflow, /\[0-9a-f\]\{40\}/);
  assert.match(workflow, /git rev-parse origin\/main/);
  assert.match(workflow, /test "\$\(git rev-parse origin\/main\)" = "\$SOURCE_SHA"/);
});

test("workflow audits the Core project and Production environment", () => {
  assert.match(workflow, /EXPECTED_PROJECT_NAME: npp-platform/);
  assert.match(workflow, /EXPECTED_ROOT_DIRECTORY: npp-core\/web/);
  assert.match(workflow, /EXPECTED_PRODUCTION_DOMAIN: npp-platform\.vercel\.app/);
  assert.match(workflow, /\.rootDirectory == \$root/);
  assert.match(workflow, /CORE_API_INTERNAL_URL CORE_API_SERVER_TOKEN/);
  assert.match(workflow, /DATABASE_URL SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(workflow, /vercel pull --yes --environment=production/);
});

test("workflow deploys the exact SHA and verifies READY production ownership", () => {
  assert.match(workflow, /vercel deploy/);
  assert.match(workflow, /--prod/);
  assert.match(workflow, /--archive=tgz/);
  assert.match(workflow, /--meta githubCommitSha="\$SOURCE_SHA"/);
  assert.match(workflow, /vercel inspect "\$DEPLOYMENT_URL" --wait --timeout=10m/);
  assert.match(workflow, /\.target == "production"/);
  assert.match(workflow, /\.readyState == "READY"/);
  assert.match(workflow, /\.meta\.githubCommitSha == \$sha/);
  assert.match(workflow, /deployments\/\$EXPECTED_PRODUCTION_DOMAIN/);
  assert.match(workflow, /\.live == true/);
});

test("workflow smoke tests required production surfaces", () => {
  assert.match(workflow, /check_route "\/"/);
  assert.match(workflow, /check_route "\/dashboard"/);
  assert.match(workflow, /check_route "\/login"/);
  assert.match(workflow, /\/_next\/static\//);
});

test("workflow never toggles or pushes the deployment gate", () => {
  assert.doesNotMatch(workflow, /deploymentEnabled: true/);
  assert.doesNotMatch(workflow, /Open one-shot production gate/);
  assert.doesNotMatch(workflow, /Re-lock automatic deployments/);
  assert.doesNotMatch(workflow, /git push/);
  assert.doesNotMatch(workflow, /vcp_[A-Za-z0-9_-]+/);
});
