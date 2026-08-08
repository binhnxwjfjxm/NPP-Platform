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

  assert.doesNotMatch(workflow, /working-directory: mcp\//);
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

const phase97Manifest = JSON.parse(
  await readFile(
    new URL("../../docs/operations/phase-9-7-route-runtime-manifest.json", import.meta.url),
    "utf8"
  )
);
const phase97Sources = {
  "npp-operations": await readFile(
    new URL("../../npp-core/web/app/components/app-shell-core.tsx", import.meta.url),
    "utf8"
  ),
  "mcp-field": await readFile(
    new URL("../src/ui/shell/navigation.ts", import.meta.url),
    "utf8"
  ),
  "admin-mcp-npp": await readFile(
    new URL("../../admin/web/app/admin-shell.tsx", import.meta.url),
    "utf8"
  ),
  delivery: await readFile(
    new URL("../../delivery/web/app/DeliveryAppFrame.tsx", import.meta.url),
    "utf8"
  )
};
const phase97EnvFiles = {
  "npp-operations": await readFile(
    new URL("../../npp-core/web/.env.example", import.meta.url),
    "utf8"
  ),
  "mcp-field": await readFile(new URL("../.env.example", import.meta.url), "utf8"),
  "admin-mcp-npp": await readFile(
    new URL("../../admin/web/.env.example", import.meta.url),
    "utf8"
  ),
  delivery: await readFile(
    new URL("../../delivery/web/.env.example", import.meta.url),
    "utf8"
  )
};

test("Phase 9.7 manifest locks exactly six independent frontend projects", () => {
  assert.equal(phase97Manifest.phase, "9.7");
  assert.equal(phase97Manifest.issue, 394);
  assert.equal(phase97Manifest.frontends.length, 6);
  assert.equal(new Set(phase97Manifest.frontends.map((item) => item.id)).size, 6);
  assert.equal(new Set(phase97Manifest.frontends.map((item) => item.vercel.projectId)).size, 6);
  assert.equal(new Set(phase97Manifest.frontends.map((item) => item.expectedDomain)).size, 6);
});

test("Phase 9.7 source route audit has no orphan top-level business route", () => {
  for (const frontend of phase97Manifest.frontends) {
    assert.equal(frontend.routeAudit.status, "PASS", frontend.id);
    assert.equal(frontend.routeAudit.orphanTopLevelCount, 0, frontend.id);
  }
  for (const [id, source] of Object.entries(phase97Sources)) {
    const frontend = phase97Manifest.frontends.find((item) => item.id === id);
    assert.ok(frontend, id);
    for (const href of frontend.routeAudit.entryHrefs) {
      if (href === "/") continue;
      assert.ok(source.includes(href), `${id} missing navigation evidence for ${href}`);
    }
  }
});

test("Phase 9.7 locks source-declared production environment variable names without values", () => {
  for (const [id, source] of Object.entries(phase97EnvFiles)) {
    const frontend = phase97Manifest.frontends.find((item) => item.id === id);
    assert.ok(frontend, id);
    for (const name of frontend.productionRelevantEnvNames) {
      assert.match(source, new RegExp(`^${name}=`, "m"), `${id}:${name}`);
    }
  }
  const serialized = JSON.stringify(phase97Manifest);
  assert.doesNotMatch(serialized, /postgres(?:ql)?:\/\//i);
  assert.doesNotMatch(serialized, /\b(?:password|secret|token)\s*[:=]/i);
});

test("Phase 9.7 Vercel evidence is repository/main/READY but production drift remains explicit", () => {
  for (const frontend of phase97Manifest.frontends) {
    const deployment = frontend.vercel.latestProductionDeployment;
    assert.equal(deployment.state, "READY", frontend.id);
    assert.equal(deployment.target, "production", frontend.id);
    assert.equal(deployment.githubCommitRef, "main", frontend.id);
    assert.equal(
      `binhnxwjfjxm/${deployment.githubRepository}`,
      frontend.repository,
      frontend.id
    );
  }
  const nppMain = phase97Manifest.auditBaselines.nppPlatform.mainCommit;
  const externalMain = phase97Manifest.auditBaselines.websiteCustomer.mainCommit;
  assert.ok(
    phase97Manifest.frontends.some(
      (item) =>
        item.repository.endsWith("/NPP-Platform") &&
        item.vercel.latestProductionDeployment.githubCommitSha !== nppMain
    )
  );
  assert.ok(
    phase97Manifest.frontends.some(
      (item) =>
        item.repository.endsWith("/nguyenlieuhungphat") &&
        item.vercel.latestProductionDeployment.githubCommitSha !== externalMain
    )
  );
});

test("Phase 9.7 refuses to claim provider closure that the current connector cannot read", () => {
  assert.equal(phase97Manifest.gate.routeReachabilitySource, "PASS");
  assert.equal(phase97Manifest.gate.providerProjectIdentity, "PASS");
  assert.equal(phase97Manifest.gate.providerRepositoryAndProductionBranch, "PASS");
  assert.equal(phase97Manifest.gate.providerRootDirectory, "PARTIAL");
  assert.equal(phase97Manifest.gate.providerEnvironmentNamePresence, "NOT_VERIFIED");
  assert.equal(phase97Manifest.gate.providerCustomDomainAssignment, "NOT_VERIFIED");
  assert.equal(phase97Manifest.gate.providerAutoDeployOff, "NOT_VERIFIED");
  assert.equal(phase97Manifest.gate.mcpBackendApiBaseProductionValue, "NOT_VERIFIED");
  assert.equal(phase97Manifest.gate.phase97ProductionReady, false);
  assert.deepEqual(
    phase97Manifest.productionMutations,
    {
      vercelDeployment: false,
      environmentChange: false,
      domainChange: false,
      dnsSwitch: false,
      backendDeploy: false,
      databaseMigration: false
    }
  );
});

test("Phase 9.7 MCP source keeps backend API routing server-owned", async () => {
  const serverEnv = await readFile(new URL("../src/server/env.ts", import.meta.url), "utf8");
  const nextConfig = await readFile(new URL("../next.config.mjs", import.meta.url), "utf8");
  const mcp = phase97Manifest.frontends.find((item) => item.id === "mcp-field");
  assert.equal(mcp.backendTarget.expectedService, "hung-phat-mcp");
  assert.equal(mcp.backendTarget.apiBaseVariable, "BACKEND_API_BASE_URL");
  assert.match(serverEnv, /required\("BACKEND_API_BASE_URL"\)/);
  assert.match(nextConfig, /requiredBuildEnv\("BACKEND_API_BASE_URL"\)/);
  assert.doesNotMatch(serverEnv, /NEXT_PUBLIC_BACKEND_API_BASE_URL/);
});
