import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const workflowsDir = path.join(repoRoot, ".github/workflows");
const staleRunner = "run-user-facing-copy-cleanup.yml";

const deploymentWorkflows = new Set([
  "vercel-production-manual.yml",
  "vercel-mcp-production-manual.yml",
  "heroku-npp-backend-manual.yml",
  "heroku-mcp-backend-manual.yml"
]);

function topLevelBlockRange(lines, key) {
  const start = lines.findIndex((line) => line === `${key}:`);
  if (start < 0) throw new Error(`missing_top_level_${key}`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^[A-Za-z_][A-Za-z0-9_-]*:/.test(line)) {
      end = index;
      break;
    }
  }
  return { start, end };
}

function replaceTopLevelBlock(source, key, replacement) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const { start, end } = topLevelBlockRange(lines, key);
  const replacementLines = replacement.trimEnd().split("\n");
  return [...lines.slice(0, start), ...replacementLines, ...lines.slice(end)].join("\n");
}

function ensureConcurrency(source, slug, cancelInProgress = true) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const existing = lines.findIndex((line) => line === "concurrency:");
  const block = [
    "concurrency:",
    `  group: ${slug}-\${{ github.ref }}`,
    `  cancel-in-progress: ${cancelInProgress ? "true" : "false"}`,
    ""
  ];
  if (existing >= 0) {
    const { start, end } = topLevelBlockRange(lines, "concurrency");
    return [...lines.slice(0, start), ...block, ...lines.slice(end)].join("\n");
  }
  const jobsIndex = lines.findIndex((line) => line === "jobs:");
  if (jobsIndex < 0) throw new Error(`missing_jobs_${slug}`);
  return [...lines.slice(0, jobsIndex), ...block, ...lines.slice(jobsIndex)].join("\n");
}

function addFoundationScopeTest(source) {
  if (source.includes("Verify CI workflow scope matrix")) return source;
  const marker = "      - name: Verify Vercel deployment controls";
  const index = source.indexOf(marker);
  if (index < 0) throw new Error("foundation_scope_test_marker_missing");
  const step = [
    "      - name: Verify CI workflow scope matrix",
    "        run: node --test test/ci-workflow-scope-matrix.test.mjs",
    "",
    ""
  ].join("\n");
  return `${source.slice(0, index)}${step}${source.slice(index)}`;
}

const sharedTrigger = `on:
  pull_request:
    branches:
      - main
    paths:
      - ".gitignore"
      - "package.json"
      - "package-lock.json"
      - "Procfile"
      - ".github/workflows/**"
      - "mcp/scripts/audit-workflow-paths.mjs"
      - "mcp/test/ci-workflow-scope-matrix.test.mjs"
      - "mcp/test/vercel-deployment-control.test.mjs"
      - "mcp/test/vercel-mcp-deployment-control.test.mjs"
      - "mcp/test/manual-production-deploy-matrix.test.mjs"
      - "mcp/test/heroku-root-contract.test.mjs"
  push:
    branches:
      - main
    paths:
      - ".gitignore"
      - "package.json"
      - "package-lock.json"
      - "Procfile"
      - ".github/workflows/**"
      - "mcp/scripts/audit-workflow-paths.mjs"
      - "mcp/test/ci-workflow-scope-matrix.test.mjs"
      - "mcp/test/vercel-deployment-control.test.mjs"
      - "mcp/test/vercel-mcp-deployment-control.test.mjs"
      - "mcp/test/manual-production-deploy-matrix.test.mjs"
      - "mcp/test/heroku-root-contract.test.mjs"
  workflow_dispatch:
`;

const manualPhaseTrigger = `on:
  workflow_dispatch:
`;

function onBlock(source) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const { start, end } = topLevelBlockRange(lines, "on");
  return lines.slice(start, end).join("\n");
}

const workflowNames = (await fs.readdir(workflowsDir))
  .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
  .sort();

for (const name of workflowNames) {
  if (name === staleRunner) continue;
  const filePath = path.join(workflowsDir, name);
  let source = await fs.readFile(filePath, "utf8");

  if (name === "foundation-f0-2.yml") {
    source = replaceTopLevelBlock(source, "on", sharedTrigger);
    source = ensureConcurrency(source, "foundation-f0-2");
    source = addFoundationScopeTest(source);
  } else if (name.startsWith("phase-")) {
    source = replaceTopLevelBlock(source, "on", manualPhaseTrigger);
    source = ensureConcurrency(source, name.replace(/\.ya?ml$/, ""));
  } else if (!deploymentWorkflows.has(name) && name !== "heroku-mcp-deploy-evidence.yml") {
    const triggers = onBlock(source);
    if (triggers.includes("pull_request:") || triggers.includes("push:") || triggers.includes("workflow_dispatch:")) {
      source = ensureConcurrency(source, name.replace(/\.ya?ml$/, ""));
    }
  }

  await fs.writeFile(filePath, source.endsWith("\n") ? source : `${source}\n`);
}

const contractTest = `import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "../..");
const workflowsDir = path.join(repoRoot, ".github/workflows");

const deployFiles = new Set([
  "vercel-production-manual.yml",
  "vercel-mcp-production-manual.yml",
  "heroku-npp-backend-manual.yml",
  "heroku-mcp-backend-manual.yml"
]);

function topLevelBlock(source, key) {
  const lines = source.replace(/\\r\\n/g, "\\n").split("\\n");
  const start = lines.findIndex((line) => line === key + ":");
  assert.notEqual(start, -1, "missing " + key + " block");
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^[A-Za-z_][A-Za-z0-9_-]*:/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\\n");
}

function pullRequestPaths(source) {
  const block = topLevelBlock(source, "on").split("\\n");
  const prIndex = block.findIndex((line) => line.trim() === "pull_request:");
  if (prIndex < 0) return [];
  const pathsIndex = block.findIndex((line, index) => index > prIndex && line.trim() === "paths:");
  if (pathsIndex < 0) return [];
  const values = [];
  for (let index = pathsIndex + 1; index < block.length; index += 1) {
    const line = block[index];
    if (!/^\\s{6}- /.test(line)) break;
    values.push(line.replace(/^\\s{6}- /, "").trim().replace(/^['\"]|['\"]$/g, ""));
  }
  return values;
}

function globMatches(pattern, value) {
  let regex = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*" && pattern[index + 1] === "*") {
      regex += ".*";
      index += 1;
    } else if (char === "*") {
      regex += "[^/]*";
    } else if (char === "?") {
      regex += ".";
    } else {
      regex += char.replace(/[.*+?^$()|[\\]{}]/g, "\\\\$&");
    }
  }
  regex += "$";
  return new RegExp(regex).test(value);
}

async function inventory() {
  const names = (await readdir(workflowsDir)).filter((name) => /\\.ya?ml$/.test(name)).sort();
  return Promise.all(names.map(async (name) => ({
    name,
    source: await readFile(path.join(workflowsDir, name), "utf8")
  })));
}

test("deploy workflows stay command/manual only", async () => {
  const files = await inventory();
  for (const file of files.filter(({ name }) => deployFiles.has(name))) {
    const block = topLevelBlock(file.source, "on");
    assert.match(block, /workflow_dispatch:/, file.name);
    assert.doesNotMatch(block, /\\npull_request:/, file.name);
    assert.doesNotMatch(block, /\\npush:/, file.name);
  }
});

test("historical phase workflows are manual only", async () => {
  const files = await inventory();
  for (const file of files.filter(({ name }) => name.startsWith("phase-"))) {
    const block = topLevelBlock(file.source, "on");
    assert.match(block, /workflow_dispatch:/, file.name);
    assert.doesNotMatch(block, /pull_request:/, file.name);
    assert.doesNotMatch(block, /push:/, file.name);
  }
});

test("automatic CI workflows are domain scoped and cancel stale branch runs", async () => {
  const files = await inventory();
  for (const file of files) {
    const block = topLevelBlock(file.source, "on");
    const automatic = block.includes("pull_request:") || block.includes("push:");
    if (!automatic) continue;
    assert.match(file.source, /^concurrency:\\n/m, file.name + " concurrency");
    assert.match(file.source, /cancel-in-progress: true/, file.name + " cancellation");
    const paths = pullRequestPaths(file.source);
    const hasMcp = paths.some((entry) => entry.startsWith("mcp/"));
    const hasCore = paths.some((entry) => entry.startsWith("npp-core/") || entry.startsWith("database/") || entry.startsWith("packages/"));
    assert.equal(hasMcp && hasCore, false, file.name + " mixes MCP and Core paths");
  }
});

test("representative path matrix never crosses domains", async () => {
  const files = await inventory();
  const scenarios = [
    { path: "mcp/src/features/mcp/McpSessionCompactViewFinal2.tsx", forbidden: ["npp-core/", "database/", "packages/"] },
    { path: "npp-core/web/app/page.tsx", forbidden: ["mcp/"] },
    { path: "docs/operations/example.md", forbidden: ["mcp/", "npp-core/", "database/", "packages/"] }
  ];
  for (const scenario of scenarios) {
    const matched = files.filter((file) => pullRequestPaths(file.source).some((pattern) => globMatches(pattern, scenario.path)));
    for (const file of matched) {
      const paths = pullRequestPaths(file.source);
      for (const prefix of scenario.forbidden) {
        assert.equal(paths.some((entry) => entry.startsWith(prefix)), false, scenario.path + " -> " + file.name);
      }
    }
    if (scenario.path.startsWith("docs/")) assert.equal(matched.length, 0, "docs-only change must not start CI");
  }
});

test("stale one-time cleanup runner is removed", async () => {
  const names = await readdir(workflowsDir);
  assert.equal(names.includes("run-user-facing-copy-cleanup.yml"), false);
});
`;

await fs.writeFile(path.join(repoRoot, "mcp/test/ci-workflow-scope-matrix.test.mjs"), contractTest);

const matrixDoc = `# GitHub Actions scope matrix

## MCP-only change

- Runs only matching MCP workflows whose existing path filters cover the changed MCP file.
- Core workflows, historical phase workflows and deployment workflows do not start.

## NPP Core-only change

- Runs only matching Core workflows whose existing path filters cover the changed Core file.
- MCP workflows, historical phase workflows and deployment workflows do not start.

## Docs-only change

- No automatic CI workflow starts.
- A workflow can still be started manually when an operator intentionally needs historical evidence.

## Deployment workflows

- Vercel and Heroku production workflows accept only workflow_dispatch or the exact approved Issue #5 command.
- They never start from push or pull_request.

## Concurrency

- Automatic CI workflows cancel an older in-progress run for the same branch or pull request.
- Production deployment workflows keep their existing non-cancelling serialized behavior.
`;
await fs.writeFile(path.join(repoRoot, "docs/operations/github-actions-scope-matrix.md"), matrixDoc);

await fs.rm(path.join(workflowsDir, staleRunner), { force: true });
console.log(`ci_scope_matrix_applied workflows=${workflowNames.length}`);
