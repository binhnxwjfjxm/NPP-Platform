import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('Issue #1140 Lô 3 keeps scheduling in one workforce screen with office-language child tabs', async () => {
  const [workspace, panel] = await Promise.all([
    source('app/workforce/schedules/work-schedule-workspace.tsx'),
    source('app/workforce/schedules/schedule-planning-panel.tsx'),
  ]);

  assert.match(workspace, /SchedulePlanningPanel/);
  assert.match(panel, />Ca mẫu</);
  assert.match(panel, />Lịch tuần</);
  assert.match(panel, />Ngày lễ và ngày nghỉ</);
  assert.match(panel, />Xếp lịch hàng loạt</);
  assert.doesNotMatch(workspace, /· bản \$\{schedule\.policy_version\}/);
  assert.doesNotMatch(workspace, /· bản \{policy\.version\}/);
});

test('Issue #1140 Lô 3 mutation producers use canonical idempotency keys and stable retry attempts', async () => {
  const [panel, gateway, proxy] = await Promise.all([
    source('app/workforce/schedules/schedule-planning-panel.tsx'),
    source('lib/workforce-gateway.ts'),
    source('app/api/workforce/schedule-planning/route.ts'),
  ]);

  assert.match(panel, /createIdempotencyKey\(prefix\)/);
  assert.match(panel, /attemptRef\.current\.signature !== signature/);
  assert.match(gateway, /mutationKey\(idempotencyKey, 'schedule-planning-save'\)/);
  assert.match(proxy, /request\.headers\.get\('idempotency-key'\)/);
});

test('Issue #1140 Lô 3 covers weekly apply, schedule copy and Company days off', async () => {
  const [bulk, calendar, week, shift] = await Promise.all([
    source('app/workforce/schedules/bulk-schedule-panel.tsx'),
    source('app/workforce/schedules/company-calendar-panel.tsx'),
    source('app/workforce/schedules/week-template-panel.tsx'),
    source('app/workforce/schedules/shift-template-panel.tsx'),
  ]);

  assert.match(bulk, /APPLY_WEEK_TEMPLATE/);
  assert.match(bulk, /COPY_SCHEDULE/);
  assert.match(bulk, /lịch điều chỉnh riêng/);
  assert.match(calendar, /Ngày nghỉ Công Ty/);
  assert.match(calendar, /nút Điều chỉnh/);
  assert.match(week, /Ngày làm việc/);
  assert.match(shift, /Nghỉ giữa ca/);
});
