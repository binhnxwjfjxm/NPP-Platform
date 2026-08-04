import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { auditWorkflowPaths, auditWorkflowText } from "../scripts/audit-workflow-paths.mjs";

test("repository workflows use workspace-aware paths", async () => {
  const result = await auditWorkflowPaths();
  assert.ok(result.filenames.length > 0);
  assert.deepEqual(result.errors, []);
});

test("auditor rejects legacy root assumptions", () => {
  const errors = auditWorkflowText("legacy.yml", `
on:
  pull_request:
    paths:
      - "src/**"
      - "tsconfig.json"
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v4
        with:
          cache: npm
          cache-dependency-path: package-lock.json
      - run: npm ci
      - uses: actions/upload-artifact@v4
        with:
          path: test-results/smoke
`);

  assert.ok(errors.some((error) => error.includes("legacy_root_path_filter:src/**")));
  assert.ok(errors.some((error) => error.includes("legacy_root_path_filter:tsconfig.json")));
  assert.ok(errors.some((error) => error.includes("npm_without_workspace_working_directory")));
  assert.ok(errors.some((error) => error.includes("npm_cache_missing_workspace_lockfile")));
  assert.ok(errors.some((error) => error.includes("artifact_path_missing_workspace:test-results/smoke")));
});

test("auditor accepts MCP workspace paths", () => {
  const errors = auditWorkflowText("mcp.yml", `
on:
  pull_request:
    paths:
      - "mcp/src/**"
      - ".github/workflows/mcp.yml"
jobs:
  test:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: mcp
    steps:
      - uses: actions/setup-node@v4
        with:
          cache: npm
          cache-dependency-path: mcp/package-lock.json
      - run: npm ci
      - uses: actions/upload-artifact@v4
        with:
          path: |
            mcp/test-results/smoke
            mcp/.next/static/css
`);
  assert.deepEqual(errors, []);
});

test("auditor accepts Delivery frontend workspace paths", () => {
  const errors = auditWorkflowText("delivery.yml", `
on:
  pull_request:
    paths:
      - "delivery/web/**"
      - ".github/workflows/delivery.yml"
jobs:
  test:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: delivery/web
    steps:
      - uses: actions/setup-node@v4
        with:
          cache: npm
          cache-dependency-path: delivery/web/package-lock.json
      - run: npm ci
      - run: npm run verify
      - uses: actions/upload-artifact@v4
        with:
          path: delivery/web/playwright-report
`);
  assert.deepEqual(errors, []);
});

test("auditor accepts root workspace dependency triggers", () => {
  const errors = auditWorkflowText("core-foundation.yml", `
on:
  pull_request:
    paths:
      - "package.json"
      - "package-lock.json"
      - "npp-core/**"
jobs:
  verify-core:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: npp-core
    steps:
      - run: npm --prefix .. ci
      - run: npm --prefix .. run verify:core-api
`);
  assert.deepEqual(errors, []);
});

test("auditor discovers both yml and yaml files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workflow-path-audit-"));
  try {
    const workflows = path.join(root, ".github", "workflows");
    await mkdir(workflows, { recursive: true });
    const valid = `jobs:\n  test:\n    defaults:\n      run:\n        working-directory: npp-core\n    steps:\n      - run: npm test\n`;
    await writeFile(path.join(workflows, "one.yml"), valid, "utf8");
    await writeFile(path.join(workflows, "two.yaml"), valid, "utf8");
    const result = await auditWorkflowPaths({ repoRoot: root });
    assert.deepEqual(result.filenames, ["one.yml", "two.yaml"]);
    assert.deepEqual(result.errors, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
