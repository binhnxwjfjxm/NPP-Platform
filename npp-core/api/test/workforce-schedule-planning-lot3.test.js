import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL('../' + path, import.meta.url), 'utf8');
}

test('Issue #1140 Lô 3 adds reusable shift, weekly schedule and Company calendar sources', async () => {
  const [migration, registry] = await Promise.all([
    source('../../database/migrations/shared/151_workforce_schedule_planning.sql'),
    source('src/migrations/index.js'),
  ]);

  assert.match(registry, /151_workforce_schedule_planning/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS shared\.work_shift_templates/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS shared\.work_week_templates/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS shared\.work_week_template_days/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS shared\.company_calendar_days/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS shift_template_id/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS week_template_id/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS company_calendar_day_id/);
  assert.match(migration, /grant_company_runtime_access/);
});

test('Issue #1140 Lô 3 planning endpoint reuses schedule permission, idempotency and audit transaction', async () => {
  const route = await source('src/routes/workforce.js');

  assert.match(route, /\/schedule-planning/);
  assert.match(route, /coreWorkScheduleRead/);
  assert.match(route, /coreWorkScheduleManage/);
  assert.match(route, /runIdempotentMutation/);
  assert.match(route, /withAuditOutboxTransaction/);
  assert.match(route, /workforcePlanningService\.mutateSchedulePlanning/);
});

test('Issue #1140 Lô 3 bulk planner preserves individual overrides and validates future policy coverage', async () => {
  const [repository, bulk] = await Promise.all([
    source('src/db/repositories/workforce-planning.js'),
    source('src/services/workforce-planning-bulk.js'),
  ]);

  assert.match(repository, /jsonb_to_recordset/);
  assert.match(repository, /WHERE existing\.source <> 'OVERRIDE'/);
  assert.match(repository, /company_calendar_day_id/);
  assert.match(bulk, /APPLY_WEEK_TEMPLATE|applyWeekTemplate/);
  assert.match(bulk, /copySchedule/);
  assert.match(bulk, /WORK_POLICY_REQUIRED/);
  assert.match(bulk, /company_calendar_day_id: calendarDay\?\.id/);
  assert.doesNotMatch(bulk, /calendarDay \|\| day\.schedule_kind/);
  assert.match(bulk, /skippedOverrides/);
});

test('Issue #1140 Lô 3 person-day override clears template provenance but remains audited by existing schedule flow', async () => {
  const [repository, route] = await Promise.all([
    source('src/db/repositories/workforce.js'),
    source('src/routes/workforce.js'),
  ]);

  assert.match(repository, /source = 'OVERRIDE'/);
  assert.match(repository, /shift_template_id = NULL/);
  assert.match(repository, /week_template_id = NULL/);
  assert.match(repository, /company_calendar_day_id = NULL/);
  assert.match(route, /resourceType: 'work-schedule'/);
  assert.match(route, /beforeData: result\.beforeSchedule/);
});
