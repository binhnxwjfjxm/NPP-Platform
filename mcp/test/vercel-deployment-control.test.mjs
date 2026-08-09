import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
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
  assert.match(workflow, new RegExp(`VERCEL_PROJECT_ID: ${NPP_PLATFORM_PROJECT_ID}`));
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
  "mcp-field": await readFile(new URL("../src/ui/shell/navigation.ts", import.meta.url), "utf8"),
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
  delivery: await readFile(new URL("../../delivery/web/.env.example", import.meta.url), "utf8")
};

const EXPECTED_PHASE97_FRONTENDS = [
  ["admin-mcp-npp", "binhnxwjfjxm/NPP-Platform", "admin/web", "admin-mcp-npp", "prj_0hp2A8WyUW4zgglShPTzL70hesVC", "admin.nguyenlieuhungphat.com"],
  ["customer-ordering", "binhnxwjfjxm/nguyenlieuhungphat", "customer-ordering", "customer-ordering", "prj_btLk3p4FhmShgKFdRBMq6ZFOagKe", "sales.nguyenlieuhungphat.com"],
  ["delivery", "binhnxwjfjxm/NPP-Platform", "delivery/web", "npp-delivery", "prj_aqsb62CiXpN1a1u3vU9P8SOKw2Ux", "log.nguyenlieuhungphat.com"],
  ["mcp-field", "binhnxwjfjxm/NPP-Platform", "mcp", "mcp-field", "prj_854SWdJeDEOPezAvvTZzTaRvZUSq", "mcp.nguyenlieuhungphat.com"],
  ["npp-operations", "binhnxwjfjxm/NPP-Platform", "npp-core/web", "npp-platform", "prj_vFEAzoxesLqNJIfD8uF4q1kytpvk", "office.nguyenlieuhungphat.com"],
  ["website", "binhnxwjfjxm/nguyenlieuhungphat", ".", "nguyenlieuhungphat", "prj_rXqH83GFDHuEGUcQrrv82JBPWnjU", "nguyenlieuhungphat.com"]
];
const REQUIRED_NPP_PRODUCTION_ENV_NAMES = [
  "NEXT_PUBLIC_CORE_API_URL",
  "CORE_API_INTERNAL_URL",
  "CORE_API_SERVER_TOKEN",
  "CORE_WEB_ADMIN_USERNAME",
  "CORE_WEB_ADMIN_PASSWORD",
  "FOUNDATION_TEST_UI_ENABLED",
  "FOUNDATION_R2_TEST_ENABLED"
];
const REQUIRED_CUSTOMER_PRODUCTION_ENV_NAMES = [
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_CUSTOMER_ORDERING_DATA_MODE",
  "CORE_API_BASE_URL"
];
const CURRENT_ADMIN_PRODUCTION_ENV_NAMES = [
  "CORE_API_INTERNAL_URL",
  "NPP_OPERATIONS_URL"
];
const RETIRED_ADMIN_HUMAN_ENV_NAMES = [
  "CORE_API_SERVER_TOKEN",
  "CORE_WEB_ADMIN_USERNAME",
  "CORE_WEB_ADMIN_PASSWORD"
];

function assertNoSensitiveManifestValues(value, path = "manifest") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSensitiveManifestValues(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && !path.includes(".productionRelevantEnvNames[")) {
      assert.doesNotMatch(value, /postgres(?:ql)?:\/\/|vcp_|cfat_|cfut_|os_v2_|sb_secret_/i, path);
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (!childPath.includes(".productionRelevantEnvNames")) {
      assert.doesNotMatch(key, /(?:password|secret|token|credential|database.?url)/i, childPath);
    }
    assertNoSensitiveManifestValues(child, childPath);
  }
}

async function collectMcpSourceFiles(directoryUrl) {
  const files = [];
  for (const entry of await readdir(directoryUrl, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "coverage") continue;
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directoryUrl);
    if (entry.isDirectory()) {
      files.push(...await collectMcpSourceFiles(child));
      continue;
    }
    if (/\.(?:ts|tsx|js|mjs|json)$/.test(entry.name) && !/\.test\./.test(entry.name)) files.push(child);
  }
  return files;
}

test("Phase 9.7 manifest locks the exact six frontend identities", () => {
  assert.equal(phase97Manifest.phase, "9.7");
  assert.equal(phase97Manifest.issue, 394);
  const actual = phase97Manifest.frontends
    .map((item) => [
      item.id,
      item.repository,
      item.sourceRoot,
      item.vercel.projectName,
      item.vercel.projectId,
      item.expectedDomain
    ])
    .sort((a, b) => a[0].localeCompare(b[0]));
  assert.deepEqual(actual, EXPECTED_PHASE97_FRONTENDS);
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

test("Phase 9.7 external frontend evidence is pinned to exact GitHub commits", () => {
  assert.match(phase97Manifest.auditBaselines.websiteCustomer.mainCommit, /^[0-9a-f]{40}$/);
  assert.match(phase97Manifest.auditBaselines.websiteCustomer.treeSha, /^[0-9a-f]{40}$/);
  assert.match(phase97Manifest.auditBaselines.websiteCustomer.phase97HeadCommit, /^[0-9a-f]{40}$/);
  for (const id of ["website", "customer-ordering"]) {
    const frontend = phase97Manifest.frontends.find((item) => item.id === id);
    assert.equal(frontend.repository, "binhnxwjfjxm/nguyenlieuhungphat");
    assert.equal(frontend.routeAudit.evidenceMode, "EXTERNAL_GITHUB_AUDIT");
  }
});

test("Phase 9.7 env evidence stays historical while Phase 9.9 Admin supersession is explicit", () => {
  for (const [id, source] of Object.entries(phase97EnvFiles)) {
    const frontend = phase97Manifest.frontends.find((item) => item.id === id);
    assert.ok(frontend, id);
    if (id === "admin-mcp-npp") continue;
    for (const name of frontend.productionRelevantEnvNames) {
      assert.match(source, new RegExp(`^${name}=`, "m"), `${id}:${name}`);
    }
  }

  const historicalAdmin = phase97Manifest.frontends.find((item) => item.id === "admin-mcp-npp");
  const currentAdmin = phase97EnvFiles["admin-mcp-npp"];
  assert.ok(historicalAdmin);
  for (const name of RETIRED_ADMIN_HUMAN_ENV_NAMES) {
    assert.ok(historicalAdmin.productionRelevantEnvNames.includes(name), `phase-9.7:${name}`);
    assert.doesNotMatch(currentAdmin, new RegExp(`^${name}=`, "m"), `phase-9.9:${name}`);
  }
  for (const name of CURRENT_ADMIN_PRODUCTION_ENV_NAMES) {
    assert.match(currentAdmin, new RegExp(`^${name}=`, "m"), `phase-9.9:${name}`);
  }
  const currentAdminNames = currentAdmin
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[A-Z0-9_]+=/.test(line))
    .map((line) => line.slice(0, line.indexOf("=")))
    .sort();
  assert.deepEqual(currentAdminNames, [...CURRENT_ADMIN_PRODUCTION_ENV_NAMES].sort());

  const npp = phase97Manifest.frontends.find((item) => item.id === "npp-operations");
  assert.deepEqual([...npp.productionRelevantEnvNames].sort(), [...REQUIRED_NPP_PRODUCTION_ENV_NAMES].sort());
  const customer = phase97Manifest.frontends.find((item) => item.id === "customer-ordering");
  assert.deepEqual(
    [...customer.productionRelevantEnvNames].sort(),
    [...REQUIRED_CUSTOMER_PRODUCTION_ENV_NAMES].sort()
  );
  assert.equal(customer.logoAsset.mode, "LOCAL_PUBLIC_ASSET");
  assert.equal(customer.logoAsset.path, "/logo-transparent.png");
  assert.equal(customer.logoAsset.externalEnvironmentVariableRequired, false);
  assertNoSensitiveManifestValues(phase97Manifest);
});

test("Phase 9.7 Vercel evidence keeps deployment drift explicit", () => {
  for (const frontend of phase97Manifest.frontends) {
    const deployment = frontend.vercel.latestProductionDeployment;
    assert.equal(deployment.state, "READY", frontend.id);
    assert.equal(deployment.target, "production", frontend.id);
    assert.equal(deployment.githubCommitRef, "main", frontend.id);
    assert.equal(`binhnxwjfjxm/${deployment.githubRepository}`, frontend.repository, frontend.id);
    assert.equal(frontend.vercel.customDomainAssignmentStatus, "VERIFIED_PROJECT_META", frontend.id);
    assert.ok(frontend.vercel.assignedDomains.includes(frontend.expectedDomain), frontend.id);
  }
  const nppMain = phase97Manifest.auditBaselines.nppPlatform.mainCommit;
  const externalMain = phase97Manifest.auditBaselines.websiteCustomer.mainCommit;
  assert.ok(
    phase97Manifest.frontends.some(
      (item) => item.repository.endsWith("/NPP-Platform") && item.vercel.latestProductionDeployment.githubCommitSha !== nppMain
    )
  );
  assert.ok(
    phase97Manifest.frontends.some(
      (item) => item.id === "website" && item.vercel.latestProductionDeployment.githubCommitSha !== externalMain
    )
  );
});

test("Phase 9.7 records provider evidence without claiming undeployed source is production-ready", () => {
  assert.equal(phase97Manifest.gate.routeReachabilitySource, "PASS");
  assert.equal(phase97Manifest.gate.providerProjectIdentity, "PASS");
  assert.equal(phase97Manifest.gate.providerRepositoryAndProductionBranch, "PASS");
  assert.equal(phase97Manifest.gate.providerRootDirectory, "PASS");
  assert.equal(phase97Manifest.gate.providerEnvironmentNamePresence, "PASS");
  assert.equal(phase97Manifest.gate.providerCustomDomainAssignment, "PASS");
  assert.equal(phase97Manifest.gate.providerAutoDeployOff, "PASS");
  assert.equal(phase97Manifest.gate.mcpBackendApiBaseProductionValue, "PASS");
  assert.equal(phase97Manifest.gate.dnsState, "PASS");
  assert.equal(phase97Manifest.gate.dnsSwitch, "NOT_REQUIRED_ALREADY_CORRECT");
  assert.equal(phase97Manifest.gate.environmentSwitch, "CONFIGURED_PENDING_DEPLOY");
  assert.equal(phase97Manifest.gate.sourceMergePending, true);
  assert.equal(phase97Manifest.gate.productionDeployPending, true);
  assert.equal(phase97Manifest.gate.phase97ProductionReady, false);
  assert.deepEqual(phase97Manifest.productionMutations, {
    vercelDeployment: false,
    environmentChange: false,
    domainChange: false,
    dnsSwitch: false,
    backendDeploy: false,
    databaseMigration: false
  });
});

test("Phase 9.7 MCP source keeps backend API routing server-owned", async () => {
  const serverEnv = await readFile(new URL("../src/server/env.ts", import.meta.url), "utf8");
  const nextConfig = await readFile(new URL("../next.config.mjs", import.meta.url), "utf8");
  const mcp = phase97Manifest.frontends.find((item) => item.id === "mcp-field");
  assert.equal(mcp.backendTarget.expectedService, "hung-phat-mcp");
  assert.equal(mcp.backendTarget.apiBaseVariable, "BACKEND_API_BASE_URL");
  assert.equal(mcp.backendTarget.productionValueStatus, "VERIFIED_OWNER_PROVIDER");
  assert.match(serverEnv, /required\("BACKEND_API_BASE_URL"\)/);
  assert.match(nextConfig, /requiredBuildEnv\("BACKEND_API_BASE_URL"\)/);

  const scanned = [
    ...await collectMcpSourceFiles(new URL("../src/", import.meta.url)),
    new URL("../next.config.mjs", import.meta.url),
    new URL("../package.json", import.meta.url),
    new URL("../tsconfig.json", import.meta.url)
  ];
  for (const file of scanned) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /NEXT_PUBLIC_BACKEND_API_BASE_URL/, file.pathname);
  }
});
