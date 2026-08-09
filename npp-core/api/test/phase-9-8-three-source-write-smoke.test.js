import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const script = await readFile(new URL('../scripts/phase-9-8-three-source-write-smoke.js', import.meta.url), 'utf8');
const workflow = await readFile(new URL('../../../.github/workflows/phase-9-8-three-source-write-smoke.yml', import.meta.url), 'utf8');

test('three-source smoke writes only draft orders inside a rollback transaction', () => {
  assert.match(script, /client\.query\('BEGIN'\)/);
  assert.match(script, /client\.query\('ROLLBACK'\)/);
  assert.match(script, /SAVEPOINT phase98_candidate/);
  assert.match(script, /SET CONSTRAINTS ALL IMMEDIATE/);
  assert.match(script, /sourceType: 'MANUAL'/);
  assert.match(script, /sourceType: 'MCP'/);
  assert.match(script, /createPortalOrder/);
  assert.match(script, /SOURCE_REFERENCE_DUPLICATE/);
  assert.match(script, /productionPersistedTestRows: 0/);
  assert.match(script, /customerPortalHttpClerkWrite: 'not_exercised_no_test_session'/);
  assert.doesNotMatch(script, /confirmSalesOrder|allocateDocumentNumber|\bCOMMIT\b/);
});

test('workflow is owner-guarded and verifies deployed PWA icon assets', () => {
  assert.match(workflow, /github\.event\.issue\.number == 395/);
  assert.match(workflow, /github\.event\.comment\.body == '\/smoke-phase-9-8-three-source-write'/);
  assert.match(workflow, /heroku@11\.0\.0/);
  assert.match(workflow, /smoke-and-verify:[\s\S]*working-directory: npp-core/);
  assert.match(workflow, /heroku run --no-tty/);
  assert.match(workflow, /slugs\/\$slug_id/);
  assert.match(workflow, /test \"\$deployed_sha\" = \"\$SOURCE_SHA\"/);
  assert.match(workflow, /PHASE_9_8_WRITE_SMOKE_RESULT/);
  assert.match(workflow, /icon-192-20260809\.png/);
  assert.match(workflow, /icon-512-20260809\.png/);
  assert.match(workflow, /hp-customer-ordering-shell-v2-20260809/);
});
