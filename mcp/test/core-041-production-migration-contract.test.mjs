import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const workflowPath = new URL(".github/workflows/heroku-core-migrations-manual.yml", root);
const gatePath = new URL("npp-core/api/scripts/core-041-production-gate.sh", root);
const workflow = (await readFile(workflowPath, "utf8")).replace(/\r\n/g, "\n");
const gate = (await readFile(gatePath, "utf8")).replace(/\r\n/g, "\n");

test("Core 041 production gate shell is valid", () => {
  execFileSync("bash", ["-n", fileURLToPath(gatePath)]);
});

test("Core migration commands are exact, manual and separate from deploy", () => {
  assert.match(workflow, /github\.event\.issue\.number == 5/);
  assert.match(workflow, /\/audit-heroku-core-migrations/);
  assert.match(workflow, /\/migrate-heroku-core-041-production/);
  assert.match(workflow, /HEROKU_APP_NAME: hung-phat/);
  assert.match(workflow, /image: postgres:17/);
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /git rev-parse --is-shallow-repository/);
  assert.match(workflow, /REQUESTED_ACTION="\$action" bash npp-core\/api\/scripts\/core-041-production-gate\.sh/);
  assert.doesNotMatch(workflow, /^\s{2}(?:push|pull_request|schedule):\s*$/m);
  assert.doesNotMatch(`${workflow}\n${gate}`, /git push|container:(?:push|release)|vercel\s+(?:deploy|--prod)/i);
});

test("Core migration gate fails closed outside exact 041 state", () => {
  assert.match(gate, /'\[\]'\|'\["041_customer_onboarding_requests"\]'/);
  assert.match(gate, /refuses unexpected pending migrations/);
  assert.match(gate, /heroku pg:backups:capture DATABASE_URL/);
  assert.match(gate, /heroku pg:backups:info "\$backup_id"/);
  assert.match(gate, /pg_dump/);
  assert.match(gate, /pg_restore/);
  assert.equal((gate.match(/run_core_command migrate/g) || []).length, 4);
  assert.equal((gate.match(/run_core_command verify/g) || []).length, 2);
  assert.match(gate, /snapshot_protected_counts/);
  assert.match(gate, /assert_counts_unchanged/);
  assert.match(gate, /heroku maintenance:on/);
  assert.match(gate, /heroku maintenance:off/);
  assert.match(gate, /smoke_health \/health\/live/);
  assert.match(gate, /smoke_health \/health\/ready/);
  assert.doesNotMatch(gate, /NODE_ENV=.*production/);
});

test("Core migration evidence is sanitized", () => {
  assert.match(workflow, /cat "\$GITHUB_STEP_SUMMARY"/);
  assert.match(workflow, /issues\/189\/comments/);
  assert.match(gate, /::add-mask::\$database_url/);
  assert.doesNotMatch(gate, /echo\s+.*\$database_url/i);
  assert.doesNotMatch(workflow, /echo\s+.*DATABASE_URL=/i);
});
