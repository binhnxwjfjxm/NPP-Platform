import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assessCutoverReadiness,
  validateCutoverPlan
} from "../apps/backend/foundation/provider-cutover.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const mcpRoot = path.resolve(testDir, "..");
const repoRoot = path.resolve(mcpRoot, "..");
const read = (relative) => readFileSync(path.join(repoRoot, relative), "utf8");
const plan = JSON.parse(read("mcp/audit/phase-6c0f/fixtures/cutover-plan.json"));

test("Phase 6C.0F cutover plan is non-secret and remains not authorized", () => {
  assert.doesNotThrow(() => JSON.parse(
    read("mcp/audit/phase-6c0f/cutover-plan.schema.json")
  ));
  const validation = validateCutoverPlan(plan, {
    expectedSourceCommit: plan.source.commit
  });
  assert.deepEqual(validation, { valid: true, issues: [] });
  const readiness = assessCutoverReadiness(plan, {
    expectedSourceCommit: plan.source.commit
  });
  assert.equal(readiness.ready, false);
  assert.equal(plan.approvalState, "DRAFT_NOT_AUTHORIZED");
  assert.equal(
    Object.values(plan.productionMutations).every((value) => value === false),
    true
  );
  const text = JSON.stringify(plan);
  for (const forbidden of ["https://", "http://", "postgresql://", "password=", "token="]) {
    assert.equal(text.includes(forbidden), false);
  }
});

test("runtime environment cannot retain the migrator credential", () => {
  const runtimeExample = read("mcp/apps/backend/.env.example");
  const migrationExample = read("mcp/apps/backend/.env.migration.example");
  const config = read("mcp/apps/backend/foundation/config.js");
  const migrationCli = read("mcp/apps/backend/foundation/migrations/cli.js");
  const credentialSafety = read("mcp/apps/backend/foundation/migrations/credential-safety.js");
  assert.equal(runtimeExample.includes("MCP_MIGRATION_DATABASE_URL="), false);
  assert.match(runtimeExample, /must not be stored in runtime app config/i);
  assert.match(
    migrationExample,
    /^MCP_MIGRATION_DATABASE_URL=<operator-only-migrator-url>$/m
  );
  assert.match(migrationExample, /^MCP_MIGRATION_CREDENTIAL_MODE=separated$/m);
  assert.match(migrationExample, /MCP_MIGRATION_CREDENTIAL_MODE=essential_owner/);
  assert.match(config, /migration_credential_forbidden_in_runtime/);
  assert.match(migrationCli, /resolveMigrationCredentialContext/);
  assert.match(credentialSafety, /migration_runtime_credential_not_separated/);
  assert.match(credentialSafety, /essential_owner_migration_not_authorized/);
  assert.match(credentialSafety, /runtime_and_migrator_target_different_databases/);
  assert.match(credentialSafety, /leastPrivilege: false/);
});

test("dedicated workflow is exact-head, disposable and provider-mutation free", () => {
  const workflow = read(
    ".github/workflows/phase-6c0f-mcp-provider-cutover-prep.yml"
  );
  assert.match(workflow, /permissions:\s*\n\s+contents: read/);
  assert.match(workflow, /image: postgres:17/);
  assert.match(
    workflow,
    /github\.event\.pull_request\.head\.sha \|\| github\.sha/
  );
  assert.match(workflow, /working-directory: mcp/);
  assert.doesNotMatch(workflow, /heroku\s+(config|releases|addons|pg:)/i);
  assert.doesNotMatch(workflow, /vercel\s+(deploy|env|promote)/i);
  assert.doesNotMatch(
    workflow,
    /MCP_CUTOVER_PREFLIGHT_ALLOW_PRODUCTION:\s*true/
  );
});

test("operator runbook preserves separate production authorization", () => {
  const runbook = read(
    "docs/operations/phase-6c0f-mcp-provider-cutover-preparation.md"
  );
  assert.match(runbook, /No production mutation is authorized by this source phase/i);
  assert.match(runbook, /MCP_MIGRATION_DATABASE_URL/);
  assert.match(runbook, /hold-field-traffic-cutover/);
  assert.match(runbook, /health\/live/);
  assert.match(runbook, /health\/ready/);
});
