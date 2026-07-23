import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { auditDirectDbMutationPolicy } from "../scripts/audit-direct-db-mutation-policy.mjs";
import { scanRepository } from "../scripts/audit-direct-db-mutations.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const retiredEdgeFiles = [
  "supabase/functions/mcp-day-8b3/index.ts",
  "supabase/functions/mcp-day-followup/index.ts"
];

function baselineEntry(fingerprint) {
  return {
    fingerprint,
    classification: "known-legacy-debt",
    operation: "mutation",
    owner: "edge-retirement",
    reason: "A5 public Edge service-role mutation debt.",
    replacementPhase: "A5.3",
    replacementTarget: "backend use case/RPC; retire public Edge"
  };
}

function retirementEntry(fingerprints) {
  return {
    phase: "A5.3",
    completedAt: "2026-07-15",
    owner: "edge-retirement",
    reason: "Legacy public Edge mutation was retired after canonical backend cutover.",
    fingerprints
  };
}

async function writeJson(root, relativePath, value) {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function makePolicyRepo(files = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mcp-a5-3-retirement-"));
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }
  await mkdir(path.join(root, "src"), { recursive: true });
  return root;
}

async function withPolicyRepo(files, callback) {
  const root = await makePolicyRepo(files);
  try {
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function audit(root, scanRoots) {
  return auditDirectDbMutationPolicy({ root, scanRoots, writeReports: false });
}

for (const relativePath of retiredEdgeFiles) {
  test(`${relativePath} is a credential-free HTTP 410 retirement stub`, async () => {
    const source = await readFile(path.join(repositoryRoot, relativePath), "utf8");

    assert.match(source, /EDGE_FUNCTION_RETIRED/);
    assert.match(source, /status:\s*410/);
    assert.match(source, /Cache-Control["']?:\s*["']no-store/i);
    assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY|SUPABASE_URL|service_role/i);
    assert.doesNotMatch(source, /\/rest\/v1\/|\/functions\/v1\//i);
    assert.doesNotMatch(source, /Access-Control-Allow-Origin|\*/i);
    assert.doesNotMatch(source, /method:\s*["'`](POST|PUT|PATCH|DELETE)["'`]/i);
  });
}

test("an explicitly retired stale baseline finding is accepted", async () => {
  await withPolicyRepo({}, async (root) => {
    const fingerprint = "deadbeefdeadbeefdeadbeef";
    await writeJson(root, "scripts/direct-db-mutation-baseline.json", {
      schemaVersion: 1,
      entries: [baselineEntry(fingerprint)]
    });
    await writeJson(root, "scripts/direct-db-mutation-retirements.json", {
      schemaVersion: 1,
      entries: [retirementEntry([fingerprint])]
    });

    const result = await audit(root, ["src"]);
    assert.deepEqual(result.errors, []);
    assert.equal(result.retirements.fingerprintCount, 1);
    assert.deepEqual(result.retirements.completedPhases, ["A5.3"]);
  });
});

test("a retired fingerprint becoming live again fails the policy gate", async () => {
  await withPolicyRepo({
    "supabase/functions/legacy/index.ts": `const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");\nexport async function save(url, body) {\n  return fetch(new URL("/rest/v1/mcp_visits", url), { method: "POST", body: JSON.stringify(body) });\n}\n`
  }, async (root) => {
    await writeJson(root, "scripts/direct-db-mutation-baseline.json", {
      schemaVersion: 1,
      entries: []
    });
    await writeJson(root, "scripts/direct-db-mutation-retirements.json", {
      schemaVersion: 1,
      entries: []
    });

    const first = await scanRepository({
      root,
      scanRoots: ["supabase"],
      writeReports: false
    });
    assert.equal(first.findings.length, 1);
    const fingerprint = first.findings[0].fingerprint;

    await writeJson(root, "scripts/direct-db-mutation-baseline.json", {
      schemaVersion: 1,
      entries: [baselineEntry(fingerprint)]
    });
    await writeJson(root, "scripts/direct-db-mutation-retirements.json", {
      schemaVersion: 1,
      entries: [retirementEntry([fingerprint])]
    });

    const result = await audit(root, ["supabase"]);
    assert.ok(result.errors.includes(`retired_finding_still_live:${fingerprint}`));
  });
});

test("a retirement cannot reference a fingerprint outside the audit baseline", async () => {
  await withPolicyRepo({}, async (root) => {
    const fingerprint = "unknownunknownunknown000";
    await writeJson(root, "scripts/direct-db-mutation-baseline.json", {
      schemaVersion: 1,
      entries: []
    });
    await writeJson(root, "scripts/direct-db-mutation-retirements.json", {
      schemaVersion: 1,
      entries: [retirementEntry([fingerprint])]
    });

    const result = await audit(root, ["src"]);
    assert.ok(result.errors.includes(`retirement_unknown_baseline_fingerprint:${fingerprint}`));
  });
});
