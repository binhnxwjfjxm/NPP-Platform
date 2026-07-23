import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { auditDirectDbMutationPolicy } from "../scripts/audit-direct-db-mutation-policy.mjs";

async function withRepo(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mcp-retirement-subphase-"));
  try {
    await mkdir(path.join(root, "scripts"), { recursive: true });
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("a completed subphase may retire debt scheduled under its parent phase", async () => {
  await withRepo(async (root) => {
    const fingerprint = "deadbeefdeadbeefdeadbeef";
    await writeFile(
      path.join(root, "scripts/direct-db-mutation-baseline.json"),
      JSON.stringify({
        schemaVersion: 1,
        entries: [{
          fingerprint,
          classification: "known-legacy-debt",
          operation: "mutation",
          owner: "session-report",
          reason: "Fixture scheduled for parent phase.",
          replacementPhase: "A5.4",
          replacementTarget: "backend aggregate"
        }]
      }),
      "utf8"
    );
    await writeFile(
      path.join(root, "scripts/direct-db-mutation-retirements.json"),
      JSON.stringify({
        schemaVersion: 1,
        entries: [{
          phase: "A5.4.2",
          completedAt: "2026-07-16",
          owner: "session-report-aggregate",
          reason: "The specific A5.4.2 slice retired this fingerprint.",
          fingerprints: [fingerprint]
        }]
      }),
      "utf8"
    );

    const result = await auditDirectDbMutationPolicy({
      root,
      scanRoots: [],
      writeReports: false
    });

    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.retirements.completedPhases, ["A5.4.2"]);
    assert.equal(result.retirements.fingerprintCount, 1);
  });
});

test("an unrelated phase still cannot retire parent-phase debt", async () => {
  await withRepo(async (root) => {
    const fingerprint = "feedfacefeedfacefeedface";
    await writeFile(
      path.join(root, "scripts/direct-db-mutation-baseline.json"),
      JSON.stringify({
        schemaVersion: 1,
        entries: [{
          fingerprint,
          classification: "known-legacy-debt",
          operation: "mutation",
          owner: "session-report",
          reason: "Fixture scheduled for A5.4.",
          replacementPhase: "A5.4",
          replacementTarget: "backend aggregate"
        }]
      }),
      "utf8"
    );
    await writeFile(
      path.join(root, "scripts/direct-db-mutation-retirements.json"),
      JSON.stringify({
        schemaVersion: 1,
        entries: [{
          phase: "A5.5",
          completedAt: "2026-07-16",
          owner: "wrong-phase",
          reason: "This phase must not be accepted.",
          fingerprints: [fingerprint]
        }]
      }),
      "utf8"
    );

    const result = await auditDirectDbMutationPolicy({
      root,
      scanRoots: [],
      writeReports: false
    });

    assert.ok(result.errors.includes(`retirement_phase_mismatch:${fingerprint}:A5.4:A5.5`));
  });
});
