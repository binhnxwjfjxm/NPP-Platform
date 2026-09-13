import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);

async function read(relativePath) {
  return readFile(new URL(relativePath, root), "utf8");
}

test("VPS DB parity preserves the exact Heroku state instead of repairing source debt", async () => {
  const workflow = await read(".github/workflows/vps-db-heroku-rehearsal-manual.yml");
  const parity = await read("npp-core/api/scripts/vps-db-heroku-parity-gate-958.sh");

  assert.match(workflow, /continue-on-error: \$\{\{ steps\.request\.outputs\.action == 'rehearse' \}\}/);
  assert.match(workflow, /steps\.gate\.outcome == 'failure'/);
  assert.match(workflow, /vps-db-heroku-parity-gate-958\.sh/);
  assert.match(workflow, /Verify preserved Heroku state on VPS/);

  assert.match(parity, /cmp -s "\$source_before" "\$source_after"/);
  assert.match(parity, /cmp -s "\$migration_before" "\$migration_after"/);
  assert.match(parity, /NORMALIZED_CATALOG_PARITY=PASS/);
  assert.match(parity, /CONSTRAINT_TRIGGER_VIEW_SEMANTIC_PARITY=PASS/);
  assert.match(parity, /SOURCE_INTEGRITY_STATE=PRESERVED/);
  assert.match(parity, /PARITY_POLICY=preserve_source_state/);
  assert.match(parity, /PARITY_GATE=PASS/);

  // Existing Heroku debt is allowed only when the VPS carries the same state.
  assert.doesNotMatch(parity, /VALIDATE CONSTRAINT|ALTER TABLE .*DROP CONSTRAINT|CREATE TRIGGER|DROP TRIGGER/i);
  assert.doesNotMatch(parity, /maintenance:on|maintenance:off|pg:promote/);
  assert.match(parity, /PRODUCTION_TRAFFIC=not_enabled/);
  assert.match(parity, /CUTOVER=not_performed/);
});
