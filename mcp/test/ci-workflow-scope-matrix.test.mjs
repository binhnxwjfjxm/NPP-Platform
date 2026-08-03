import assert from "node:assert/strict";
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
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => line === key + ":");
  assert.notEqual(start, -1, "missing " + key + " block");
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^[A-Za-z_][A-Za-z0-9_-]*:/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

function pullRequestPaths(source) {
  const block = topLevelBlock(source, "on").split("\n");
  const prIndex = block.findIndex((line) => line.trim() === "pull_request:");
  if (prIndex < 0) return [];
  const pathsIndex = block.findIndex((line, index) => index > prIndex && line.trim() === "paths:");
  if (pathsIndex < 0) return [];
  const values = [];
  for (let index = pathsIndex + 1; index < block.length; index += 1) {
    const line = block[index];
    if (!/^\s{6}- /.test(line)) break;
    values.push(line.replace(/^\s{6}- /, "").trim().replace(/^['"]|['"]$/g, ""));
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
      regex += char.replace(/[.*+?^$()|[\]{}]/g, "\\$&");
    }
  }
  regex += "$";
  return new RegExp(regex).test(value);
}

async function inventory() {
  const names = (await readdir(workflowsDir)).filter((name) => /\.ya?ml$/.test(name)).sort();
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
    assert.doesNotMatch(block, /\npull_request:/, file.name);
    assert.doesNotMatch(block, /\npush:/, file.name);
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
    assert.match(file.source, /^concurrency:\n/m, file.name + " concurrency");
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
