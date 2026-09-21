import * as repo from '../db/repositories/workforce-planning.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE = /^[A-Z0-9_-]{1,64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;
const CALENDAR_KINDS = new Set(['PUBLIC_HOLIDAY', 'COMPANY_DAY_OFF']);

function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function fail(code, message) { return { ok: false, code, message, retryable: false }; }
function validUuid(value) { return typeof value === 'string' && UUID.test(value.trim()); }
function validDate(value) {
  if (typeof value !== 'string' || !DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function integer(value, min, max, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : NaN;
}
function today() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function audit(action, resourceType, resourceId, beforeData, afterData) {
  return { action, resourceType, resourceId, beforeData: beforeData ?? null, afterData: afterData ?? null, metadata: {} };
}

export async function getSchedulePlanningCatalog(client, { installationId }) {
  const [shiftTemplates, weekTemplates, calendarDays] = await Promise.all([
    repo.listShiftTemplates(client, { installationId }),
    repo.listWeekTemplates(client, { installationId }),
    repo.listCalendarDays(client, { installationId }),
  ]);
  return { ok: true, data: { shiftTemplates, weekTemplates, calendarDays } };
}

export async function saveShiftTemplate(client, { installationId, payload, actorId }) {
  const id = text(payload.id) || null;
  if (id && !validUuid(id)) return fail('SHIFT_TEMPLATE_NOT_FOUND', 'Không tìm thấy ca mẫu');
  const code = text(payload.code).toUpperCase();
  const name = text(payload.name);
  const startTime = text(payload.startTime);
  const endTime = text(payload.endTime);
  const breakMinutes = integer(payload.breakMinutes, 0, 720, 0);
  const isActive = payload.isActive !== false;
  if (!CODE.test(code)) return fail('INVALID_SHIFT_CODE', 'Mã ca chỉ dùng chữ in hoa, số, gạch ngang hoặc gạch dưới');
  if (!name || name.length > 256) return fail('INVALID_SHIFT_NAME', 'Tên ca là bắt buộc và tối đa 256 ký tự');
  if (!TIME.test(startTime) || !TIME.test(endTime) || startTime === endTime) {
    return fail('INVALID_SHIFT_TIME', 'Giờ bắt đầu và kết thúc ca không hợp lệ');
  }
  if (Number.isNaN(breakMinutes)) return fail('INVALID_SHIFT_BREAK', 'Thời gian nghỉ giữa ca không hợp lệ');
  const before = id ? await repo.getShiftTemplateById(client, { installationId, id }) : null;
  if (id && !before) return fail('SHIFT_TEMPLATE_NOT_FOUND', 'Không tìm thấy ca mẫu');
  const duplicate = await repo.getShiftTemplateByCode(client, { installationId, code });
  if (duplicate && duplicate.id !== id) return fail('SHIFT_TEMPLATE_CODE_EXISTS', 'Mã ca đã được sử dụng');
  const saved = await repo.saveShiftTemplate(client, {
    installationId, id, code, name, startTime, endTime, breakMinutes, isActive, actorId,
  });
  return {
    ok: true, data: saved,
    audit: audit(before ? 'update' : 'create', 'work-shift-template', saved.id, before, saved),
  };
}

export async function saveWeekTemplate(client, { installationId, payload, actorId }) {
  const id = text(payload.id) || null;
  if (id && !validUuid(id)) return fail('WEEK_TEMPLATE_NOT_FOUND', 'Không tìm thấy mẫu lịch tuần');
  const code = text(payload.code).toUpperCase();
  const name = text(payload.name);
  const isActive = payload.isActive !== false;
  if (!CODE.test(code)) return fail('INVALID_WEEK_TEMPLATE_CODE', 'Mã lịch tuần chỉ dùng chữ in hoa, số, gạch ngang hoặc gạch dưới');
  if (!name || name.length > 256) return fail('INVALID_WEEK_TEMPLATE_NAME', 'Tên lịch tuần là bắt buộc và tối đa 256 ký tự');
  if (!Array.isArray(payload.days) || payload.days.length !== 7) {
    return fail('INVALID_WEEK_TEMPLATE_DAYS', 'Mẫu lịch tuần phải có đủ 7 ngày');
  }
  const shifts = new Map((await repo.listShiftTemplates(client, { installationId })).map((item) => [item.id, item]));
  const seen = new Set();
  const days = [];
  for (const input of payload.days) {
    const weekday = integer(input?.weekday, 0, 6);
    const scheduleKind = text(input?.scheduleKind).toUpperCase();
    if (Number.isNaN(weekday) || seen.has(weekday) || !['WORK', 'OFF'].includes(scheduleKind)) {
      return fail('INVALID_WEEK_TEMPLATE_DAYS', 'Các ngày trong mẫu lịch tuần không hợp lệ');
    }
    seen.add(weekday);
    if (scheduleKind === 'OFF') {
      days.push({ weekday, scheduleKind: 'OFF', shiftTemplateId: null });
    } else {
      const shiftTemplateId = text(input?.shiftTemplateId);
      const shift = shifts.get(shiftTemplateId);
      if (!validUuid(shiftTemplateId) || !shift || !shift.is_active) {
        return fail('SHIFT_TEMPLATE_NOT_FOUND', 'Ngày làm việc phải dùng một ca mẫu đang hoạt động');
      }
      days.push({ weekday, scheduleKind: 'WORK', shiftTemplateId });
    }
  }
  days.sort((a, b) => a.weekday - b.weekday);
  const before = id ? await repo.getWeekTemplateById(client, { installationId, id }) : null;
  if (id && !before) return fail('WEEK_TEMPLATE_NOT_FOUND', 'Không tìm thấy mẫu lịch tuần');
  const duplicate = await repo.getWeekTemplateByCode(client, { installationId, code });
  if (duplicate && duplicate.id !== id) return fail('WEEK_TEMPLATE_CODE_EXISTS', 'Mã lịch tuần đã được sử dụng');
  const saved = await repo.saveWeekTemplate(client, {
    installationId, id, code, name, isActive, days, actorId,
  });
  return {
    ok: true, data: saved,
    audit: audit(before ? 'update' : 'create', 'work-week-template', saved.id, before, saved),
  };
}

export async function saveCalendarDay(client, { installationId, payload, actorId }) {
  const calendarDate = text(payload.calendarDate);
  const calendarKind = text(payload.calendarKind).toUpperCase();
  const name = text(payload.name);
  const isActive = payload.isActive !== false;
  if (!validDate(calendarDate)) return fail('INVALID_CALENDAR_DATE', 'Ngày nghỉ không hợp lệ');
  if (calendarDate <= today()) {
    return fail('HISTORICAL_CALENDAR_LOCKED', 'Ngày hôm nay và quá khứ chỉ dùng để đối chiếu; chỉ được cấu hình ngày nghỉ tương lai');
  }
  if (!CALENDAR_KINDS.has(calendarKind)) return fail('INVALID_CALENDAR_KIND', 'Loại ngày nghỉ không hợp lệ');
  if (!name || name.length > 256) return fail('INVALID_CALENDAR_NAME', 'Tên ngày nghỉ là bắt buộc và tối đa 256 ký tự');
  const before = await repo.getCalendarDayByDate(client, { installationId, calendarDate });
  const saved = await repo.saveCalendarDay(client, {
    installationId, calendarDate, calendarKind, name, isActive, actorId,
  });
  return {
    ok: true, data: saved,
    audit: audit(before ? 'update' : 'create', 'company-calendar-day', saved.id, before, saved),
  };
}
