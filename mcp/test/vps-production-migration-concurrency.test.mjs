import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowPaths = [
  ".github/workflows/vps-production-migration-135-manual.yml",
  ".github/workflows/vps-production-migration-136-manual.yml",
  ".github/workflows/vps-production-migration-137-manual.yml",
  ".github/workflows/vps-production-migration-138-139-manual.yml",
];

test("VPS production migration concurrency is owned only by the matching job", async () => {
  for (const workflowPath of workflowPaths) {
    const workflow = await readFile(workflowPath, "utf8");

    assert.doesNotMatch(workflow, /^concurrency:\s*$/m, workflowPath);
    assert.match(
      workflow,
      /^    concurrency:\n      group: vps-production-db-migration\n      cancel-in-progress: false$/m,
      workflowPath,
    );
    assert.match(workflow, /^    if: >-$/m, workflowPath);
  }
});
