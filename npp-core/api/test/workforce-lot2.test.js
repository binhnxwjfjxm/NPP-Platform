import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('Issue #1110 Lô 2 exposes workforce policy, assignment, and schedule routes', async () => {
  const [server, route, service, repository] = await Promise.all([
    source('src/server.js'),
    source('src/routes/workforce.js'),
    source('src/services/workforce.js'),
    source('src/db/repositories/workforce.js'),
  ]);

  assert.match(server, /handleWorkforceRoutes/);
  for (const path of ['/policies', '/assignments', '/schedules']) assert.match(route, new RegExp(path.replace('/', '\\/')));
  assert.match(route, /coreWorkPolicyRead/);
  assert.match(route, /coreWorkPolicyManage/);
  assert.match(route, /coreWorkScheduleRead/);
  assert.match(route, /coreWorkScheduleManage/);
  assert.match(route, /withAuditOutboxTransaction/);
  assert.match(route, /executeRequestWithIdempotency/);
  assert.match(repository, /shared\.work_policies/);
  assert.match(repository, /shared\.employee_work_policy_assignments/);
  assert.match(repository, /shared\.work_schedules/);
  assert.match(service, /POLICY_VERSION_CONFLICT/);
  assert.match(service, /ASSIGNMENT_EFFECTIVE_DATE_CONFLICT/);
  assert.match(service, /HISTORICAL_SCHEDULE_LOCKED/);
});

test('Issue #1110 Lô 2 uses explicit scope authority instead of deriving company scope from role names', async () => {
  const [context, auth, route] = await Promise.all([
    source('src/request-context-base.js'),
    source('src/internal-workforce-auth.js'),
    source('src/routes/workforce.js'),
  ]);

  assert.match(context, /scopeAuthority: principal\.scopeAuthority === 'COMPANY'/);
  assert.match(context, /scopeAuthority: 'COMPANY'/);
  assert.match(auth, /scopeAuthority: authorization\.ownerKind \? 'COMPANY' : 'ASSIGNED'/);
  assert.match(route, /requestContext\.scopeAuthority === 'COMPANY'/);
  assert.doesNotMatch(route, /COMPANY_SCOPE_ROLES/);
  assert.match(route, /requestContext\.scopes\.branchIds/);
});

test('Issue #1110 Lô 2 makes employee PATCH idempotent with the canonical store', async () => {
  const route = await source('src/routes/employees.js');
  const idempotency = await source('src/idempotency.js');

  assert.match(route, /async function handlePatch/);
  assert.match(route, /requireIdempotencyKey\(req\)/);
  assert.match(route, /route: `\/api\/employees\/\$\{id\}`/);
  assert.match(route, /executeRequestWithIdempotency/);
  assert.match(route, /withAuditOutboxTransaction/);
  assert.match(idempotency, /IDEMPOTENCY_KEY_PATTERN/);
});

test('Issue #1110 Lô 2 preserves policy history and blocks retroactive schedule edits', async () => {
  const service = await source('src/services/workforce.js');

  assert.match(service, /version = latest \? Number\(latest\.version\) \+ 1 : 1/);
  assert.match(service, /previousDate\(validation\.normalized\.effectiveFrom\)/);
  assert.match(service, /effectiveFrom < localDate\(\)/);
  assert.match(service, /workDate <= localDate\(\)/);
  assert.match(service, /expectedUpdatedAt/);
  assert.match(service, /SCHEDULE_CONFLICT/);
});
