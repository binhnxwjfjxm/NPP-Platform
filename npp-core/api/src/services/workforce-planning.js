import {
  getSchedulePlanningCatalog,
  saveCalendarDay,
  saveShiftTemplate,
  saveWeekTemplate,
} from './workforce-planning-templates.js';
import { applyWeekTemplate, copySchedule } from './workforce-planning-bulk.js';

const ACTIONS = new Set([
  'SAVE_SHIFT_TEMPLATE',
  'SAVE_WEEK_TEMPLATE',
  'SAVE_CALENDAR_DAY',
  'APPLY_WEEK_TEMPLATE',
  'COPY_SCHEDULE',
]);

function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function fail(code, message) { return { ok: false, code, message, retryable: false }; }

export { getSchedulePlanningCatalog };

export async function mutateSchedulePlanning(client, {
  installationId, payload, actorId, branchIds = null,
}) {
  const action = text(payload?.action).toUpperCase();
  if (!ACTIONS.has(action)) return fail('INVALID_PLANNING_ACTION', 'Thao tác xếp lịch không hợp lệ');
  const input = { installationId, payload, actorId, branchIds };
  if (action === 'SAVE_SHIFT_TEMPLATE') return saveShiftTemplate(client, input);
  if (action === 'SAVE_WEEK_TEMPLATE') return saveWeekTemplate(client, input);
  if (action === 'SAVE_CALENDAR_DAY') return saveCalendarDay(client, input);
  if (action === 'APPLY_WEEK_TEMPLATE') return applyWeekTemplate(client, input);
  return copySchedule(client, input);
}
